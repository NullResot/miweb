// This script runs inside an opaque-origin sandbox. No imported page script executes here.
(() => {
  const { token, nodes } = window.__MIWEB__;
  const metadata = new Map(nodes.map((node) => [node.id, node]));
  const elements = new Map(
    [...document.querySelectorAll("[data-mi-id]")].map((element) => [
      element.dataset.miId,
      element,
    ]),
  );
  const originals = new Map(
    [...elements].map(([id, element]) => [id, element.getAttribute("style")]),
  );
  const send = (type, payload = {}) =>
    parent.postMessage({ miweb: token, type, ...payload }, "*");
  let selected = null,
    changes = {},
    compare = false,
    drag = null,
    editing = true;
  const overlay = document.createElement("div");
  overlay.dataset.miUi = "selection";
  overlay.style.cssText =
    "position:fixed;z-index:2147483647;pointer-events:none;border:1.5px solid #3569ef;box-sizing:border-box;display:none;";
  const label = document.createElement("div");
  label.style.cssText =
    'position:absolute;bottom:100%;left:-1.5px;background:#3569ef;color:white;border-radius:3px 3px 0 0;padding:4px 7px;white-space:nowrap;font:11px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:280px;overflow:hidden;text-overflow:ellipsis;';
  overlay.append(label);
  for (const [handle, css] of Object.entries({
    nw: "left:-4px;top:-4px;cursor:nwse-resize",
    n: "left:calc(50% - 4px);top:-4px;cursor:ns-resize",
    ne: "right:-4px;top:-4px;cursor:nesw-resize",
    e: "right:-4px;top:calc(50% - 4px);cursor:ew-resize",
    se: "right:-4px;bottom:-4px;cursor:nwse-resize",
    s: "left:calc(50% - 4px);bottom:-4px;cursor:ns-resize",
    sw: "left:-4px;bottom:-4px;cursor:nesw-resize",
    w: "left:-4px;top:calc(50% - 4px);cursor:ew-resize",
  })) {
    const dot = document.createElement("div");
    dot.dataset.miHandle = handle;
    dot.style.cssText = `position:absolute;width:7px;height:7px;box-sizing:border-box;background:white;border:1px solid #3569ef;pointer-events:auto;${css}`;
    overlay.append(dot);
  }
  const hover = document.createElement("div");
  hover.dataset.miUi = "hover";
  hover.style.cssText =
    "position:fixed;z-index:2147483646;pointer-events:none;border:1px dashed #7298f7;background:rgba(53,105,239,.025);display:none;box-sizing:border-box;";
  const uiHost = document.createElement('miweb-tools');
  uiHost.dataset.miUi = 'root';
  uiHost.style.cssText = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
  uiHost.attachShadow({mode:'open'}).append(hover,overlay);
  document.documentElement.append(uiHost);
  const baseline = (id) => changes[id] || { id, x: 0, y: 0 };
  const affected = (id) => {
    const source = metadata.get(id)?.sourceId;
    return source
      ? nodes.filter((node) => node.sourceId === source).map((node) => node.id)
      : [id];
  };
  let appliedIds = new Set();
  function apply() {
    const nextIds = compare ? [] : Object.keys(changes);
    const touched = new Set([...appliedIds, ...nextIds]);
    for (const id of touched) {
      const element = elements.get(id);
      if (!element) continue;
      const original = originals.get(id);
      if (original == null) element.removeAttribute("style");
      else element.setAttribute("style", original);
      const change = compare ? null : changes[id];
      if (!change) continue;
      if (change.x || change.y) {
        const initial = metadata.get(id)?.baseTranslate;
        let translate = `${change.x || 0}px ${change.y || 0}px`;
        if (initial && initial !== "none") {
          const [x = "0px", y = "0px", z] = initial.split(/\s+(?![^()]*\))/);
          translate = `calc(${x} + ${change.x || 0}px) calc(${y} + ${change.y || 0}px)${z ? ` ${z}` : ""}`;
        }
        element.style.setProperty("translate", translate, "important");
      }
      for (const name of ["width", "height", "fontSize", "borderRadius"])
        if (change[name] != null)
          element.style.setProperty(
            name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`),
            `${change[name]}px`,
            "important",
          );
      if (change.width != null || change.height != null)
        element.style.setProperty("box-sizing", "border-box", "important");
    }
    appliedIds = new Set(nextIds);
    updateOverlay();
  }
  function updateOverlay() {
    const element = elements.get(selected);
    overlay.style.display = element && editing && !compare ? "block" : "none";
    if (!element) return;
    const rect = element.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    label.textContent = `${metadata.get(selected)?.tag}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    label.style.bottom = rect.y < 25 ? "auto" : "100%";
    label.style.top = rect.y < 25 ? "100%" : "auto";
    const style = getComputedStyle(element);
    send("geometry", {
      id: selected,
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fontSize: parseFloat(style.fontSize) || 16,
        borderRadius: parseFloat(style.borderRadius) || 0,
      },
    });
  }
  function select(id, scroll = false) {
    selected = elements.has(id) ? id : null;
    hover.style.display = "none";
    if (scroll)
      elements.get(selected)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    updateOverlay();
    const rect = elements.get(selected)?.getBoundingClientRect();
    const style = selected ? getComputedStyle(elements.get(selected)) : null;
    send("selected", {
      id: selected,
      rect: rect
        ? {
            width: rect.width,
            height: rect.height,
            fontSize: parseFloat(style.fontSize) || 16,
            borderRadius: parseFloat(style.borderRadius) || 0,
          }
        : null,
    });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.miweb !== token) return;
    const message = event.data;
    if (message.type === "changes") {
      changes = message.changes;
      compare = message.compare;
      apply();
    }
    if (message.type === "select") select(message.id, message.scroll);
    if (message.type === "mode") {
      editing = message.editing;
      hover.style.display = "none";
      updateOverlay();
    }
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.composedPath()[0] instanceof Element ? event.composedPath()[0] : event.target;
      if (!editing || compare || event.button !== 0) return;
      const handle = target.closest("[data-mi-handle]")?.dataset.miHandle;
      if (!handle && target.closest("[data-mi-ui]")) return;
      const element = handle
        ? elements.get(selected)
        : target.closest("[data-mi-id]");
      if (!element) {
        select(null);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      window.focus();
      const id = element.dataset.miId;
      select(id);
      const rect = element.getBoundingClientRect();
      drag = {
        id,
        handle,
        x: event.clientX,
        y: event.clientY,
        change: { ...baseline(id) },
        width: rect.width,
        height: rect.height,
        pointerId: event.pointerId,
        moved: false,
      };
      element.setPointerCapture?.(event.pointerId);
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (drag) {
        event.preventDefault();
        const dx = Math.round(event.clientX - drag.x),
          dy = Math.round(event.clientY - drag.y);
        if (!drag.moved && Math.hypot(dx, dy) < 2) return;
        drag.moved = true;
        let change = { ...drag.change };
        if (drag.handle) {
          const h = drag.handle;
          if (/[ew]/.test(h))
            change.width = Math.min(
              10000,
              Math.max(
                1,
                Math.round(drag.width + (h.includes("w") ? -dx : dx)),
              ),
            );
          if (/[ns]/.test(h))
            change.height = Math.min(
              10000,
              Math.max(
                1,
                Math.round(drag.height + (h.includes("n") ? -dy : dy)),
              ),
            );
          if (h.includes("w")) change.x += drag.width - change.width;
          if (h.includes("n")) change.y += drag.height - change.height;
        } else {
          change.x += dx;
          change.y += dy;
        }
        change.x = Math.max(-10000, Math.min(10000, change.x));
        change.y = Math.max(-10000, Math.min(10000, change.y));
        for (const id of affected(drag.id)) changes[id] = { ...change, id };
        apply();
        send("dragging", { id: drag.id, change });
      } else if (editing && !compare) {
        const element = event.target.closest("[data-mi-id]");
        if (
          element &&
          element.dataset.miId !== selected &&
          !event.target.closest("[data-mi-ui]")
        ) {
          const rect = element.getBoundingClientRect();
          Object.assign(hover.style, {
            display: "block",
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          });
        } else hover.style.display = "none";
      }
    },
    true,
  );
  const finish = (event) => {
    if (!drag) return;
    const current = drag;
    drag = null;
    if (event.type === "pointercancel") {
      send("cancelDrag");
      return;
    }
    if (current.moved)
      send("commit", { id: current.id, change: baseline(current.id) });
  };
  document.addEventListener("pointerup", finish, true);
  document.addEventListener("pointercancel", finish, true);
  document.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
  document.addEventListener("submit", (event) => event.preventDefault(), true);
  document.addEventListener(
    "keydown",
    (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        ["z", "y", "s"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        send("shortcut", {
          key: event.key.toLowerCase(),
          shift: event.shiftKey,
        });
        return;
      }
      if (event.key === "Escape") {
        select(null);
        return;
      }
      if (!selected || !editing || compare || !event.key.startsWith("Arrow"))
        return;
      event.preventDefault();
      send("nudge", {
        id: selected,
        key: event.key,
        step: event.shiftKey ? 10 : 1,
        resize: event.altKey,
      });
    },
    true,
  );
  window.addEventListener("scroll", updateOverlay, true);
  window.addEventListener("resize", updateOverlay);
  new ResizeObserver(updateOverlay).observe(document.body);
  document.documentElement.style.scrollBehavior = "auto";
  send("ready");
})();
