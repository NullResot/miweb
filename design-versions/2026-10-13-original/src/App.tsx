import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FileCode2,
  FolderOpen,
  HelpCircle,
  History,
  Layers,
  Link2,
  LoaderCircle,
  Maximize,
  Monitor,
  MousePointer2,
  Move,
  PanelLeftClose,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Smartphone,
  Tablet,
  Undo2,
  X,
} from "lucide-react";
import type { Change, Changes, ExportResult, PageNode, Session } from "./types";
import { isChanged } from "./types";
import { api, copy, download } from "./api";
import { useHistory } from "./useHistory";
import bridge from "./bridge.js?raw";

const emptyChange = (id: string): Change => ({ id, x: 0, y: 0 });
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Private browsing may disable persistence. */
  }
}
const keys = {
  recent: "miweb:recent:v1",
  last: "miweb:last:v1",
  changes: "miweb:changes:v1",
};

function IconButton({
  title,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  title: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button className="logo" onClick={onClick} title="返回开始页">
      <span className="logo-mark">
        <span />
        <span />
        <span />
      </span>
      <span>
        微调<span className="logo-english">miweb</span>
      </span>
    </button>
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    container.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab") {
        const focusables = container.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, textarea, a[href], [tabindex="0"]',
        );
        if (!focusables?.length) return;
        const first = focusables[0],
          last = focusables[focusables.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === container.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-shade"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={container}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton title="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min = -10000,
  max = 10000,
  onChange,
  suffix = "px",
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  const cancelled = useRef(false);
  const focused = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    // Geometry messages can arrive while the user selects or types a number.
    // Replacing a focused draft also moves the caret and can append digits.
    if (!focused.current) setDraft(String(Math.round(value * 100) / 100));
  }, [value]);
  const save = () => {
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, Math.round(parsed * 100) / 100));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        value={draft}
        min={min}
        max={max}
        step="1"
        onFocus={() => {
          focused.current = true;
          dirty.current = false;
        }}
        onChange={(event) => {
          dirty.current = true;
          setDraft(event.target.value);
        }}
        onBlur={() => {
          focused.current = false;
          if (cancelled.current || !dirty.current) {
            cancelled.current = false;
            setDraft(String(value));
          } else save();
          dirty.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
      <small>{suffix}</small>
    </label>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [location, setLocation] = useState("");
  const [recent, setRecent] = useState<string[]>(() => stored(keys.recent, []));
  const [loading, setLoading] = useState(false);
  const [loadLabel, setLoadLabel] = useState("正在打开页面");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rect, setRect] = useState<{
    width: number;
    height: number;
    fontSize?: number;
    borderRadius?: number;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [leftTab, setLeftTab] = useState<"layers" | "changes">("layers");
  const [layersOpen, setLayersOpen] = useState(true);
  const [layerLimit, setLayerLimit] = useState(200);
  const [compare, setCompare] = useState(false);
  const [viewWidth, setViewWidth] = useState(() =>
    window.innerWidth < 600 ? 390 : 1280,
  );
  const [zoom, setZoom] = useState("fit");
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 650 });
  const [iframeReady, setIframeReady] = useState(false);
  const [dialog, setDialog] = useState<
    "help" | "import" | "key" | "reset" | "leave" | null
  >(null);
  const [pendingOpen, setPendingOpen] = useState<(() => void) | null>(null);
  const [accessKey, setAccessKey] = useState("");
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportTab, setExportTab] = useState<
    "source" | "diff" | "css" | "javascript"
  >("source");
  const [exportFile, setExportFile] = useState(0);
  const [localPath, setLocalPath] = useState("");
  const [dragChange, setDragChange] = useState<Change | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const geometry = useRef(new Map<string, { width: number; height: number }>());
  const canvas = useRef<HTMLDivElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const history = useHistory();
  const state = useRef({ session, changes: history.changes, compare });
  state.current = { session, changes: history.changes, compare };
  const selected =
    session?.nodes.find((node) => node.id === selectedId) || null;
  const sharedCount = selected?.sourceId ? session!.nodes.filter(node=>node.sourceId===selected.sourceId).length : 1;
  const changedNodes = useMemo(() => {
    const seen = new Set<string>();
    return (session?.nodes || []).filter((node) => {
      if (!history.changes[node.id] || !isChanged(history.changes[node.id]))
        return false;
      const key = node.sourceId || node.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [session, history.changes]);
  useEffect(()=>{ if(compare && !changedNodes.length) setCompare(false); },[compare,changedNodes.length]);
  useEffect(()=>{ if(!session) return; const timer=setInterval(()=>{void api(`/api/sessions/${session.id}/ping`,{}).catch(()=>{});},60000); return ()=>clearInterval(timer); },[session?.id]);
  const selectedChange =
    (dragChange?.id === selectedId ? dragChange : null) ||
    history.changes[selectedId || ""] ||
    emptyChange(selectedId || "");
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeExport = useCallback(() => setExportResult(null), []);

  const send = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      if (state.current.session)
        frame.current?.contentWindow?.postMessage(
          { miweb: state.current.session.token, type, ...payload },
          "*",
        );
    },
    [],
  );
  const selectNode = useCallback(
    (id: string | null, scroll = true) => {
      setSelectedId(id);
      setRect(null);
      send("select", { id, scroll });
    },
    [send],
  );
  const commitForNode = useCallback(
    (id: string, update: Partial<Change>) => {
      const { session, changes } = state.current;
      const node = session?.nodes.find((item) => item.id === id);
      if (!node) return;
      const change = { ...(changes[id] || emptyChange(id)), ...update, id };
      const affected = node.sourceId
        ? session!.nodes.filter((item) => item.sourceId === node.sourceId)
        : [node];
      const next = { ...changes };
      for (const item of affected) {
        if (isChanged(change)) next[item.id] = { ...change, id: item.id };
        else delete next[item.id];
      }
      history.commit(next);
      setDragChange(null);
      setExportResult(null);
    },
    [history.commit],
  );
  const nudge = useCallback(
    (id: string, key: string, step: number, resize: boolean) => {
      if (state.current.compare) return;
      const node = state.current.session?.nodes.find((item) => item.id === id);
      if (!node) return;
      const change = state.current.changes[id] || emptyChange(id);
      if (resize) {
        if (key === "ArrowLeft" || key === "ArrowRight")
          commitForNode(id, {
            width: Math.min(
              10000,
              Math.max(
                1,
                Math.round(
                  (change.width ??
                    geometry.current.get(id)?.width ??
                    node.width) + (key === "ArrowRight" ? step : -step),
                ),
              ),
            ),
          });
        else
          commitForNode(id, {
            height: Math.min(
              10000,
              Math.max(
                1,
                Math.round(
                  (change.height ??
                    geometry.current.get(id)?.height ??
                    node.height) + (key === "ArrowDown" ? step : -step),
                ),
              ),
            ),
          });
      } else if (key === "ArrowLeft" || key === "ArrowRight")
        commitForNode(id, {
          x: Math.max(
            -10000,
            Math.min(10000, change.x + (key === "ArrowRight" ? step : -step)),
          ),
        });
      else
        commitForNode(id, {
          y: Math.max(
            -10000,
            Math.min(10000, change.y + (key === "ArrowDown" ? step : -step)),
          ),
        });
    },
    [commitForNode],
  );

  useEffect(() => {
    if (!session) return;
    send("changes", { changes: history.changes, compare });
    persist(keys.changes, { id: session.id, changes: history.changes });
    setDragChange(null);
  }, [session, history.changes, compare, iframeReady, send]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const { session, changes, compare } = state.current;
      if (
        !session ||
        event.source !== frame.current?.contentWindow ||
        event.data?.miweb !== session.token
      )
        return;
      const message = event.data;
      switch (message.type) {
        case "ready":
          setIframeReady(true);
          send("changes", { changes, compare });
          send("select", { id: selectedId });
          break;
        case "selected":
          if (
            message.id === null ||
            session.nodes.some((node) => node.id === message.id)
          ) {
            setSelectedId(message.id);
            setRect(message.rect);
            setDragChange(null);
          }
          break;
        case "geometry":
          geometry.current.set(message.id, message.rect);
          if (message.id === selectedId) setRect(message.rect);
          break;
        case "dragging":
          setDragChange(message.change);
          break;
        case "cancelDrag":
          setDragChange(null);
          send("changes", { changes, compare });
          break;
        case "commit":
          if (!compare) commitForNode(message.id, message.change);
          break;
        case "nudge":
          nudge(message.id, message.key, message.step, message.resize);
          break;
        case "shortcut":
          if (message.key === "z")
            message.shift ? history.redo() : history.undo();
          else if (message.key === "y") history.redo();
          else if (message.key === "s") notify("改动已自动保存在当前浏览器");
          break;
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [
    send,
    selectedId,
    commitForNode,
    nudge,
    history.undo,
    history.redo,
    notify,
  ]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        dialog ||
        exportResult ||
        (event.target as HTMLElement).closest(
          "input, textarea, select, [contenteditable]",
        )
      )
        return;
      if (
        (event.ctrlKey || event.metaKey) &&
        ["z", "y", "s"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        if (event.key.toLowerCase() === "z")
          event.shiftKey ? history.redo() : history.undo();
        else if (event.key.toLowerCase() === "y") history.redo();
        else notify("改动已自动保存在当前浏览器");
      } else if (selectedId && event.key.startsWith("Arrow")) {
        event.preventDefault();
        nudge(selectedId, event.key, event.shiftKey ? 10 : 1, event.altKey);
      } else if (event.key === "Escape") selectNode(null);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [
    dialog,
    exportResult,
    history.undo,
    history.redo,
    selectedId,
    nudge,
    selectNode,
    notify,
  ]);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver((entries) =>
      setCanvasSize({
        width: entries[0].contentRect.width,
        height: entries[0].contentRect.height,
      }),
    );
    observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [session, layersOpen]);

  const activate = useCallback(
    (next: Session, initial: Changes = {}) => {
      setSession(next);
      setSelectedId(null);
      setRect(null);
      geometry.current.clear();
      setCompare(false);
      setIframeReady(false);
      setSearch("");
      setDragChange(null);
      setViewWidth(next.width);
      setZoom("fit");
      setExportResult(null);
      history.reset(initial);
      setLocation(
        next.location.startsWith("微调示例") || next.location === "已导入的项目"
          ? ""
          : next.location,
      );
      persist(keys.last, next.id);
      if (
        !next.location.startsWith("微调示例") &&
        next.location !== "已导入的项目"
      ) {
        const items = [
          next.location,
          ...stored<string[]>(keys.recent, []).filter(
            (item) => item !== next.location,
          ),
        ].slice(0, 5);
        setRecent(items);
        persist(keys.recent, items);
      }
    },
    [history.reset],
  );
  const handleError = useCallback((issue: unknown) => {
    if ((issue as { needsKey?: boolean }).needsKey) setDialog("key");
    else setError(issue instanceof Error ? issue.message : "操作失败，请重试");
  }, []);
  useEffect(() => {
    let cancelled = false;
    const id = stored<string | null>(keys.last, null);
    if (!id) return;
    api<Session>(`/api/sessions/${id}`, undefined, "GET")
      .then((next) => {
        if (cancelled) return;
        const saved = stored<{ id: string; changes: Changes } | null>(
          keys.changes,
          null,
        );
        activate(next, saved?.id === next.id ? saved.changes : {});
      })
      .catch(() => {
        if (!cancelled) persist(keys.last, null);
      });
    return () => {
      cancelled = true;
    };
  }, [activate]);

  const performOpen = useCallback(
    async (value: string, demo = false) => {
      setLoading(true);
      setError("");
      setLoadLabel(demo ? "正在准备示例页面" : "正在渲染当前页面");
      try {
        activate(
          await api<Session>(demo ? "/api/demo" : "/api/open", {
            location: value,
            width: viewWidth,
            height: 900,
          }),
        );
      } catch (issue) {
        handleError(issue);
      } finally {
        setLoading(false);
      }
    },
    [activate, handleError, viewWidth],
  );
  const guarded = (action: () => void) => {
    if (changedNodes.length) {
      setPendingOpen(() => action);
      setDialog("leave");
    } else action();
  };
  const openPage = (value = location) => {
    if (!value.trim()) {
      setError("输入网站链接，或从本地项目开始");
      return;
    }
    let input = value.trim();
    if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(input))
      input = `http://${input}`;
    else if (
      !/^https?:\/\//i.test(input) &&
      !/^[A-Za-z]:[\\/]|^\/|^\\\\/.test(input)
    )
      input = `https://${input}`;
    guarded(() => void performOpen(input));
  };
  const openDemo = () => guarded(() => void performOpen("", true));
  const goHome = () =>
    guarded(() => {
      setSession(null);
      history.reset();
      persist(keys.last, null);
      setError("");
    });
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = [...files].filter(
      (file) =>
        !file.webkitRelativePath
          .split("/")
          .some(
            (part) =>
              [
                "node_modules",
                ".git",
                "dist",
                "build",
                ".next",
                ".env",
              ].includes(part) || part.startsWith(".env."),
          ),
    );
    if (!picked.length) {
      setError("文件夹中没有可导入的项目文件");
      return;
    }
    if (
      picked.length > 800 ||
      picked.reduce((total, file) => total + file.size, 0) > 24 * 1024 * 1024
    ) {
      setError("项目过大。请排除大型资源，或输入本地目录");
      return;
    }
    guarded(() => {
      setDialog(null);
      setLoading(true);
      setError("");
      setLoadLabel("正在导入并渲染项目");
      void Promise.all(
        picked.map(async (file) => {
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
          return {
            path:
              file.webkitRelativePath.split("/").slice(1).join("/") ||
              file.name,
            data,
          };
        }),
      )
        .then((files) =>
          api<Session>("/api/upload", { files, width: viewWidth, height: 900 }),
        )
        .then(activate)
        .catch(handleError)
        .finally(() => setLoading(false));
    });
  };

  const requestExport = async () => {
    if (!session || !changedNodes.length) return null;
    setExporting(true);
    setError("");
    try {
      return await api<ExportResult>(`/api/sessions/${session.id}/export`, {
        changes: Object.values(history.changes).filter(isChanged),
      });
    } catch (issue) {
      handleError(issue);
      return null;
    } finally {
      setExporting(false);
    }
  };
  const showExport = async () => {
    const result = await requestExport();
    if (!result) return;
    setExportTab(
      result.files.length ? "source" : result.javascript ? "javascript" : "css",
    );
    setExportFile(0);
    setExportResult(result);
  };
  const copyCode = async () => {
    const result = await requestExport();
    if (!result) return;
    if (
      result.files.length > 1 ||
      (result.mapped < result.total && result.files.length)
    ) {
      setExportTab("diff");
      setExportResult(result);
      setExportFile(0);
      return;
    }
    try {
      await copy(result.files[0]?.updated || result.javascript || result.css);
      notify(
        result.files.length
          ? "改后的源码已复制，原文件只修改了调整部分"
          : result.javascript
            ? "布局补丁已复制，粘贴到页面脚本中即可"
            : "CSS 补丁已复制，粘贴到页面样式末尾即可",
      );
    } catch (issue) {
      handleError(issue);
      setExportResult(result);
      setExportTab(
        result.files.length
          ? "source"
          : result.javascript
            ? "javascript"
            : "css",
      );
    }
  };
  const scale =
    zoom === "fit"
      ? Math.min(1, Math.max(0.1, (canvasSize.width - 96) / viewWidth))
      : Number(zoom) / 100;
  const frameHeight = Math.max(
    600,
    Math.min(1800, (canvasSize.height - 80) / scale),
  );
  const frameHtml = useMemo(() => {
    if (!session) return "";
    const nonce = session.token;
    const origin = window.location.origin;
    const policy = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' ${origin}; img-src ${origin} data: blob:; font-src ${origin} data:; media-src ${origin} data:; connect-src 'none'; form-action 'none'; base-uri http: https:;`;
    const setup = `window.__MIWEB__=${JSON.stringify({ token: session.token, nodes: session.nodes }).replaceAll("<", "\\u003c")};`;
    return (
      session.html.replace(
        /<head([^>]*)>/i,
        `<head$1><meta http-equiv="Content-Security-Policy" content="${policy}">`,
      ) +
      `<script nonce="${nonce}">${setup}${bridge.replaceAll("</script", "<\\/script")}</script>`
    );
  }, [session]);
  const visibleNodes = useMemo(
    () =>
      (leftTab === "changes" ? changedNodes : session?.nodes || []).filter(
        (node) =>
          !search ||
          `${node.label} ${node.text} ${node.tag} ${node.selector}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [leftTab, changedNodes, session, search],
  );
  const nodeMap = useMemo(
    () => new Map(session?.nodes.map((node) => [node.id, node])),
    [session],
  );
  const depth = (node: PageNode) => {
    let current = node,
      count = 0;
    while (current.parentId && count < 5) {
      const parent = nodeMap.get(current.parentId);
      if (!parent) break;
      current = parent;
      count++;
    }
    return count;
  };
  const codeText = exportResult
    ? exportTab === "javascript"
      ? exportResult.javascript || ""
      : exportTab === "css"
        ? exportResult.css
        : exportTab === "diff"
          ? exportResult.diff
          : exportResult.files[exportFile]?.updated || ""
    : "";
  const modificationSummary = (change: Change) =>
    [
      change.x || change.y
        ? `位置 ${change.x > 0 ? "+" : ""}${change.x}, ${change.y > 0 ? "+" : ""}${change.y}`
        : "",
      change.width != null || change.height != null ? "尺寸" : "",
      change.fontSize != null ? "字号" : "",
      change.borderRadius != null ? "圆角" : "",
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className={`app ${session ? "editing" : "home"}`}>
      <header className="app-header">
        <Logo onClick={goHome} />
        {session && (
          <form
            className="header-url"
            onSubmit={(event) => {
              event.preventDefault();
              openPage();
            }}
          >
            <Link2 size={16} />
            <input
              aria-label="网站链接或本地项目地址"
              placeholder="输入网站链接或本地项目路径"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
            <button disabled={loading} type="submit">
              打开页面
            </button>
          </form>
        )}
        <div className="header-actions">
          <button
            className="quiet-button import-button"
            onClick={() => setDialog("import")}
          >
            <FolderOpen size={16} />
            <span>本地项目</span>
          </button>
          <IconButton
            title="使用帮助与快捷键"
            onClick={() => setDialog("help")}
          >
            <HelpCircle size={18} />
          </IconButton>
          {session && (
            <>
              <span className="header-divider" />
              <IconButton
                title="查看代码与最小差异"
                onClick={() => void showExport()}
                disabled={!changedNodes.length || exporting}
              >
                <Code2 size={18} />
              </IconButton>
              <button
                className="primary-button copy-button"
                onClick={() => void copyCode()}
                disabled={!changedNodes.length || exporting}
              >
                {exporting ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Copy size={15} />
                )}
                <span>
                  {session.mode === "source" ? "复制代码" : "复制补丁"}
                </span>
              </button>
            </>
          )}
        </div>
      </header>
      {!session ? (
        <main className="welcome">
          <div className="welcome-copy">
            <div className="welcome-kicker">
              <span className="small-mark" />
              AI 网页的最后一毫米
            </div>
            <h1>
              把网页调到
              <br />
              刚刚好。
            </h1>
            <p className="welcome-description">
              按钮再往上一点，卡片再宽一点。
              <br />
              用鼠标和方向键，完成你想要的细节。
            </p>
            <form
              className="welcome-input"
              onSubmit={(event) => {
                event.preventDefault();
                openPage();
              }}
            >
              <Link2 size={19} />
              <input
                aria-label="网站链接或本地项目地址"
                placeholder="粘贴网站链接，或本地项目路径"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
              <button
                className="primary-button"
                disabled={loading}
                type="submit"
              >
                打开页面
                <ArrowRight size={16} />
              </button>
            </form>
            <div className="welcome-secondary">
              <button onClick={() => setDialog("import")}>
                <FolderOpen size={15} />
                选择项目文件夹
              </button>
              <span />{" "}
              <button onClick={openDemo}>
                先试用示例
                <ArrowUpRight size={15} />
              </button>
            </div>
            {error && (
              <div className="home-error" role="alert">
                {error}
              </div>
            )}
            {recent.length > 0 && (
              <div className="recent-list">
                <span>最近打开</span>
                {recent.slice(0, 3).map((item) => (
                  <button
                    key={item}
                    onClick={() => openPage(item)}
                    title={item}
                  >
                    <History size={13} />
                    {item}
                  </button>
                ))}
              </div>
            )}
            <div className="welcome-footnote">
              <Check size={14} />
              项目源码只做局部修改<span>·</span>随时撤销<span>·</span>一键复制
            </div>
          </div>
          <div className="welcome-visual" aria-hidden="true">
            <div className="visual-toolbar">
              <i />
              <i />
              <i />
              <span>your-next-idea.com</span>
              <Maximize size={12} />
            </div>
            <div className="visual-page">
              <div className="visual-brand">Studio / 也许</div>
              <span className="visual-nav">
                关于我们&nbsp;&nbsp;&nbsp;&nbsp;作品
              </span>
              <h2>
                好的想法，
                <br />
                值得再往前一步。
              </h2>
              <p>
                一点灵感，一点耐心。
                <br />
                让每个细节都表达你的想法。
              </p>
              <div className="visual-button">
                开始探索
                <ArrowUpRight size={13} />
                <div className="visual-selection">
                  <b>button&nbsp; 132 × 42</b>
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="visual-plant">
                <div />
                <div />
                <div />
              </div>
              <div className="visual-note">
                <Move size={14} />
                <span>向上移动</span>
                <b>8 px</b>
              </div>
              <div className="visual-cursor">
                <MousePointer2 size={25} fill="#3569ef" />
                <span>你</span>
              </div>
            </div>
            <div className="visual-code">
              <span className="code-dot" />
              <code>
                <span>translate:</span> 0px -8px;
              </code>
              <Check size={13} />
              <span>只改这里</span>
            </div>
          </div>
          <div className="welcome-flow">
            <div>
              <span>
                <Link2 size={18} />
              </span>
              <h3>打开页面</h3>
              <p>一个链接，或一个本地项目</p>
            </div>
            <ChevronRight size={17} />
            <div>
              <span>
                <MousePointer2 size={18} />
              </span>
              <h3>调到满意</h3>
              <p>点击、拖动，按像素精确调整</p>
            </div>
            <ChevronRight size={17} />
            <div>
              <span>
                <FileCode2 size={18} />
              </span>
              <h3>带走改动</h3>
              <p>复制源码或 CSS 补丁</p>
            </div>
          </div>
        </main>
      ) : (
        <>
          <div className="workspace">
            <aside className="tool-rail">
              <IconButton
                title="页面元素"
                active={leftTab === "layers" && layersOpen}
                onClick={() => {
                  setLeftTab("layers");
                  setLayersOpen((value) =>
                    leftTab === "layers" ? !value : true,
                  );
                }}
              >
                <Layers size={19} />
              </IconButton>
              <IconButton
                title="改动列表"
                active={leftTab === "changes" && layersOpen}
                onClick={() => {
                  setLeftTab("changes");
                  setLayersOpen((value) =>
                    leftTab === "changes" ? !value : true,
                  );
                }}
              >
                <History size={19} />
              </IconButton>
              <div className="rail-bottom">
                <IconButton title="打开其他页面" onClick={goHome}>
                  <Plus size={19} />
                </IconButton>
                <IconButton
                  title="使用帮助与快捷键"
                  onClick={() => setDialog("help")}
                >
                  <HelpCircle size={19} />
                </IconButton>
              </div>
            </aside>
            {layersOpen && (
              <aside className="layers-panel">
                <div className="panel-heading">
                  <h2>{leftTab === "layers" ? "页面元素" : "本次改动"}</h2>
                  <IconButton
                    title="收起侧栏"
                    onClick={() => setLayersOpen(false)}
                  >
                    <PanelLeftClose size={15} />
                  </IconButton>
                </div>
                <div className="layer-search">
                  <Search size={14} />
                  <input
                    aria-label="搜索页面元素"
                    placeholder="搜索元素或文字"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setLayerLimit(200);
                    }}
                  />
                </div>
                <div className="page-root">
                  <span className="page-icon">
                    <FileCode2 size={14} />
                  </span>
                  <strong title={session.title}>{session.title}</strong>
                  <span>
                    {leftTab === "changes"
                      ? changedNodes.length
                      : session.nodes.length}
                  </span>
                </div>
                <div className="layer-list">
                  {visibleNodes.slice(0, layerLimit).map((node) => (
                    <button
                      className={`layer-row ${node.id === selectedId ? "selected" : ""}`}
                      key={node.id}
                      onClick={() => selectNode(node.id)}
                      style={{
                        paddingLeft:
                          leftTab === "layers" ? 14 + depth(node) * 10 : 14,
                      }}
                      title={node.selector}
                    >
                      <span className="node-tag">
                        {node.tag === "button" || node.tag === "a" ? (
                          <MousePointer2 size={12} />
                        ) : ["h1", "h2", "h3", "p", "span"].includes(
                            node.tag,
                          ) ? (
                          "T"
                        ) : (
                          <span className="node-square" />
                        )}
                      </span>
                      <span className="layer-label">
                        {node.label}
                        {leftTab === "changes" && (
                          <small>
                            {modificationSummary(history.changes[node.id])}
                          </small>
                        )}
                      </span>
                      {history.changes[node.id] && (
                        <span className="changed-dot" />
                      )}
                    </button>
                  ))}
                  {!visibleNodes.length && (
                    <div className="layer-empty">
                      {search ? (
                        "没有匹配的元素"
                      ) : (
                        <>
                          还没有改动
                          <br />
                          <span>点选页面中的元素开始微调</span>
                        </>
                      )}
                    </div>
                  )}
                  {visibleNodes.length > layerLimit && (
                    <button
                      className="more-layers"
                      onClick={() => setLayerLimit((value) => value + 200)}
                    >
                      显示更多元素（{visibleNodes.length - layerLimit}）
                    </button>
                  )}
                </div>
                <div className="layer-footer">
                  <span className="status-dot" />
                  {session.mode === "source"
                    ? `${session.mappedCount} 个元素已关联源码`
                    : "网页快照 · 导出 CSS 补丁"}
                </div>
              </aside>
            )}
            <main className="editor-center">
              <div className="canvas-toolbar">
                <div className="canvas-name">
                  <MousePointer2 size={15} />
                  <span>选择与调整</span>
                  <span className={`mode-badge ${session.mode}`}>
                    {session.mode === "source" ? "源码已连接" : "网页快照"}
                  </span>
                </div>
                <div className="viewport-controls">
                  <IconButton
                    title="桌面 1280px"
                    active={viewWidth === 1280}
                    onClick={() => setViewWidth(1280)}
                  >
                    <Monitor size={16} />
                  </IconButton>
                  <IconButton
                    title="平板 768px"
                    active={viewWidth === 768}
                    onClick={() => setViewWidth(768)}
                  >
                    <Tablet size={15} />
                  </IconButton>
                  <IconButton
                    title="手机 390px"
                    active={viewWidth === 390}
                    onClick={() => setViewWidth(390)}
                  >
                    <Smartphone size={15} />
                  </IconButton>
                  <span className="viewport-size">
                    {viewWidth}
                    <small>px</small>
                  </span>
                </div>
                <div className="zoom-control">
                  <select
                    aria-label="画布缩放"
                    value={zoom}
                    onChange={(event) => setZoom(event.target.value)}
                  >
                    <option value="fit">适应画布</option>
                    <option value="50">50%</option>
                    <option value="75">75%</option>
                    <option value="100">100%</option>
                    <option value="125">125%</option>
                  </select>
                  <ChevronDown size={12} />
                </div>
              </div>
              <div
                className={`canvas ${compare ? "comparing" : ""}`}
                ref={canvas}
              >
                <div className="ruler horizontal">
                  {Array.from({ length: 24 }, (_, index) => (
                    <span key={index}>{index * 100}</span>
                  ))}
                </div>
                <div className="ruler vertical">
                  {Array.from({ length: 18 }, (_, index) => (
                    <span key={index}>{index * 100}</span>
                  ))}
                </div>
                <div className="canvas-scroll">
                  <div className="preview-caption">
                    <span>{session.title}</span>
                    <span>
                      {compare ? "调整前" : "当前页面"}
                      <span className="caption-dot" />
                      {Math.round(scale * 100)}%
                    </span>
                  </div>
                  <div
                    className="frame-wrapper"
                    style={{
                      width: viewWidth * scale,
                      height: frameHeight * scale,
                    }}
                  >
                    <iframe
                      ref={frame}
                      title="可微调的页面预览"
                      sandbox="allow-scripts"
                      referrerPolicy="no-referrer"
                      srcDoc={frameHtml}
                      style={{
                        width: viewWidth,
                        height: frameHeight,
                        transform: `scale(${scale})`,
                      }}
                    />
                    {!iframeReady && (
                      <div className="frame-loading">
                        <LoaderCircle className="spin" size={20} />
                        <span>正在准备画布</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="floating-toolbar">
                  <IconButton
                    title="撤销 Ctrl/⌘ Z"
                    onClick={history.undo}
                    disabled={!history.canUndo}
                  >
                    <Undo2 size={17} />
                  </IconButton>
                  <IconButton
                    title="重做 Ctrl/⌘ Shift Z"
                    onClick={history.redo}
                    disabled={!history.canRedo}
                  >
                    <Redo2 size={17} />
                  </IconButton>
                  <span />
                  <button
                    className={`compare-button ${compare ? "active" : ""}`}
                    aria-pressed={compare}
                    onClick={() => setCompare((value) => !value)}
                    disabled={!changedNodes.length}
                  >
                    <span className="compare-icon" />
                    {compare ? "回到调整后" : "查看调整前"}
                  </button>
                </div>
                {compare && (
                  <div className="compare-note">正在查看调整前的页面</div>
                )}
              </div>
            </main>
            <aside className="inspector">
              <div className="panel-heading">
                <h2>微调属性</h2>
                {selected && (
                  <IconButton title="取消选择" onClick={() => selectNode(null)}>
                    <X size={15} />
                  </IconButton>
                )}
              </div>
              {selected ? (
                <>
                  <div className="selection-info">
                    <span className="element-tag">{selected.tag}</span>
                    <h3 title={selected.label}>{selected.label}</h3>
                    <code title={selected.selector}>{selected.selector}</code>
                    {selected.parentId && (
                      <button
                        className="parent-button"
                        onClick={() => selectNode(selected.parentId)}
                      >
                        <ArrowUp size={12} />
                        选择父元素
                      </button>
                    )}
                  </div>
                  <fieldset className="inspector-fields" disabled={compare}>
                    <section className="property-section">
                      <div className="property-title">
                        <h3>位置偏移</h3>
                        <Move size={14} />
                      </div>
                      <div className="field-grid">
                        <NumberField
                          label="X"
                          value={selectedChange.x}
                          onChange={(x) => commitForNode(selected.id, { x })}
                        />
                        <NumberField
                          label="Y"
                          value={selectedChange.y}
                          onChange={(y) => commitForNode(selected.id, { y })}
                        />
                      </div>
                      <div className="nudge-controls">
                        <IconButton
                          title="向左移动 1px"
                          onClick={() =>
                            nudge(selected.id, "ArrowLeft", 1, false)
                          }
                        >
                          <ArrowLeft size={15} />
                        </IconButton>
                        <IconButton
                          title="向上移动 1px"
                          onClick={() =>
                            nudge(selected.id, "ArrowUp", 1, false)
                          }
                        >
                          <ArrowUp size={15} />
                        </IconButton>
                        <IconButton
                          title="向下移动 1px"
                          onClick={() =>
                            nudge(selected.id, "ArrowDown", 1, false)
                          }
                        >
                          <ArrowDown size={15} />
                        </IconButton>
                        <IconButton
                          title="向右移动 1px"
                          onClick={() =>
                            nudge(selected.id, "ArrowRight", 1, false)
                          }
                        >
                          <ArrowRight size={15} />
                        </IconButton>
                        <small>Shift + 方向键：10 px</small>
                      </div>
                    </section>
                    <section className="property-section">
                      <div className="property-title">
                        <h3>尺寸</h3>
                        <Maximize size={14} />
                      </div>
                      <div className="field-grid">
                        <NumberField
                          label="宽度"
                          value={
                            selectedChange.width ??
                            rect?.width ??
                            selected.width
                          }
                          min={1}
                          onChange={(width) =>
                            commitForNode(selected.id, { width })
                          }
                        />
                        <NumberField
                          label="高度"
                          value={
                            selectedChange.height ??
                            rect?.height ??
                            selected.height
                          }
                          min={1}
                          onChange={(height) =>
                            commitForNode(selected.id, { height })
                          }
                        />
                      </div>
                      <p className="property-hint">
                        {rect &&
                        ((selectedChange.width != null &&
                          Math.abs(rect.width - selectedChange.width) > 0.5) ||
                          (selectedChange.height != null &&
                            Math.abs(rect.height - selectedChange.height) >
                              0.5))
                          ? `原页面布局限制了尺寸，实际为 ${Math.round(rect.width)} × ${Math.round(rect.height)} px`
                          : "拖动选中框的边缘也可以调整尺寸"}
                      </p>
                    </section>
                    <section className="property-section">
                      <div className="property-title">
                        <h3>细节</h3>
                      </div>
                      <div className="field-grid">
                        <NumberField
                          label="字号"
                          value={
                            selectedChange.fontSize ??
                            rect?.fontSize ??
                            selected.fontSize
                          }
                          min={1}
                          max={500}
                          onChange={(fontSize) =>
                            commitForNode(selected.id, { fontSize })
                          }
                        />
                        <NumberField
                          label="圆角"
                          value={
                            selectedChange.borderRadius ??
                            rect?.borderRadius ??
                            selected.borderRadius
                          }
                          min={0}
                          max={1000}
                          onChange={(borderRadius) =>
                            commitForNode(selected.id, { borderRadius })
                          }
                        />
                      </div>
                    </section>
                  </fieldset>
                  <div className="source-info">
                    <FileCode2 size={15} />
                    <div>
                      <strong>
                        {selected.file ? "已定位到原始代码" : "将导出 CSS 补丁"}
                      </strong>
                      <code>
                        {selected.file
                          ? `${selected.file}:${selected.line}`
                          : selected.mappingWarning ||
                            (session.mode === "snapshot"
                              ? "网站链接无法提供原始项目源码"
                              : "这个元素由页面运行时生成，未匹配到源码")}
                      </code>
                      {selected.file && selected.mappingWarning && (
                        <p>{selected.mappingWarning}</p>
                      )}
                      {sharedCount > 1 && <p>这个源码元素有 {sharedCount} 个实例，调整将同步到所有实例。</p>}
                    </div>
                  </div>
                  <div className="inspector-bottom">
                    <button
                      className="quiet-button"
                      disabled={!history.changes[selected.id]}
                      onClick={() =>
                        commitForNode(selected.id, {
                          x: 0,
                          y: 0,
                          width: null,
                          height: null,
                          fontSize: null,
                          borderRadius: null,
                        })
                      }
                    >
                      <RotateCcw size={14} />
                      恢复此元素
                    </button>
                    {history.changes[selected.id] && <span>已调整</span>}
                  </div>
                </>
              ) : (
                <div className="empty-inspector">
                  <div className="selection-illustration">
                    <MousePointer2 size={28} />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <h3>先选一个元素</h3>
                  <p>
                    点击页面里的按钮、文字或卡片，
                    <br />
                    就能开始调整。
                  </p>
                  <div className="empty-tip">
                    <Move size={17} />
                    <div>
                      <strong>拖动改变位置</strong>
                      <span>拖动选中框的边缘改变尺寸</span>
                    </div>
                  </div>
                  <div className="empty-tip">
                    <span className="arrow-key">↑</span>
                    <div>
                      <strong>方向键精确移动</strong>
                      <span>每次 1 px，按住 Shift 移动 10 px</span>
                    </div>
                  </div>
                  <div className="empty-tip">
                    <Code2 size={17} />
                    <div>
                      <strong>复制调整后的代码</strong>
                      <span>
                        {session.mode === "source"
                          ? "保留原代码，只修改微调部分"
                          : "用 CSS 补丁保留页面原有结构"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
          <footer className="status-bar">
            <div>
              <span className="status-dot" />
              {changedNodes.length
                ? `${changedNodes.length} 个元素已调整`
                : "页面已就绪"}
              <span className="status-save">
                {changedNodes.length
                  ? "改动已自动保存"
                  : "点击页面中的元素开始"}
              </span>
            </div>
            <div className="status-shortcut">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd>
                <kbd>←</kbd>
                <kbd>→</kbd> 移动
              </span>
              <span>
                <kbd>Alt</kbd> + 方向键 调尺寸
              </span>
              <button
                disabled={!changedNodes.length}
                onClick={() => setDialog("reset")}
              >
                清空调整
              </button>
            </div>
          </footer>
        </>
      )}
      {session && error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <IconButton title="关闭提示" onClick={() => setError("")}>
            <X size={15} />
          </IconButton>
        </div>
      )}
      {session?.warnings.length ? (
        <div className="warning-banner">
          <span>{session.warnings.join(" ")}</span>
        </div>
      ) : null}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {loading && (
        <div className="loading-shade" role="status">
          <div className="loading-card">
            <span className="loading-logo">
              <LoaderCircle className="spin" size={25} />
            </span>
            <h2>{loadLabel}</h2>
            <p>加载当前地址的内容，准备可以调整的画布</p>
            <div className="loading-line" />
            <small>通常需要几秒钟，复杂页面可能稍久</small>
          </div>
        </div>
      )}
      <input
        ref={filePicker}
        type="file"
        className="hidden-input"
        multiple
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(event) => {
          void importFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {dialog === "help" && (
        <Modal
          title="把细节调到刚刚好"
          subtitle="从选中一个元素开始，改动随时可以撤销。"
          onClose={closeDialog}
        >
          <div className="help-steps">
            <div>
              <MousePointer2 size={20} />
              <p>
                <strong>点选与拖动</strong>
                点击画布里的元素，拖动改变位置。拖动选中框的八个控制点改变宽高。
              </p>
            </div>
            <div>
              <Maximize size={20} />
              <p>
                <strong>精确调整</strong>
                右侧可输入位置、尺寸、字号和圆角。切换桌面、平板、手机，检查当前调整在不同宽度下的表现。
              </p>
            </div>
            <div>
              <Code2 size={20} />
              <p>
                <strong>带走改动</strong>
                连接源码时复制改后的原文件，也可以查看最小
                diff。网站链接模式复制 CSS 补丁，粘贴到原页面样式末尾。
              </p>
            </div>
          </div>
          <div className="shortcuts">
            <div>
              <span>移动 1 px</span>
              <kbd>方向键</kbd>
            </div>
            <div>
              <span>移动 10 px</span>
              <kbd>Shift + 方向键</kbd>
            </div>
            <div>
              <span>调整宽高</span>
              <kbd>Alt + 方向键</kbd>
            </div>
            <div>
              <span>撤销 / 重做</span>
              <kbd>Ctrl/⌘ Z / Shift Z</kbd>
            </div>
            <div>
              <span>取消选择</span>
              <kbd>Esc</kbd>
            </div>
          </div>
          <p className="modal-note">
            编辑的是当前页面的渲染快照。登录后的页面、交互状态、Canvas
            和跨域内嵌内容可能无法完整导入；布局调整应用于所有屏幕宽度。
          </p>
        </Modal>
      )}
      {dialog === "import" && (
        <Modal
          title="连接本地项目"
          subtitle="连接原始代码，复制与原文件对齐的最小修改。"
          onClose={closeDialog}
        >
          <button
            className="folder-drop"
            onClick={() => filePicker.current?.click()}
          >
            <span>
              <FolderOpen size={28} />
            </span>
            <strong>选择项目文件夹</strong>
            <p>支持 HTML、Vite + React、Vite + Vue</p>
            <small>自动排除 node_modules、构建产物和 .env</small>
          </button>
          <div className="or-divider">
            <span />
            或在本机运行微调时输入项目路径
            <span />
          </div>
          <form
            className="path-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (localPath.trim()) {
                setDialog(null);
                guarded(() => void performOpen(localPath.trim()));
              }
            }}
          >
            <input
              autoFocus
              aria-label="本地项目完整路径"
              placeholder="例如 D:\projects\my-website"
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
            />
            <button className="primary-button" disabled={!localPath.trim()}>
              连接项目
            </button>
          </form>
          <p className="modal-note">
            项目需要包含 index.html。只有在自己的电脑上运行微调时，才能使用本地路径或
            localhost 链接；含复杂插件或 Next.js 的项目可先启动开发服务。
            服务器部署请上传项目文件夹，或输入服务器可访问的网站链接。
            文件夹模式默认识别 React、Vue 与 @/ 别名；本地项目的其他依赖需要已安装。
          </p>
        </Modal>
      )}
      {dialog === "key" && (
        <Modal
          title="连接微调服务"
          subtitle="这个服务设置了访问密钥。"
          onClose={closeDialog}
        >
          <form
            className="key-form"
            onSubmit={(event) => {
              event.preventDefault();
              sessionStorage.setItem("miweb-access-key", accessKey);
              setDialog(null);
              notify("访问密钥已保存，请重新打开页面");
            }}
          >
            <input
              autoFocus
              type="password"
              aria-label="访问密钥"
              placeholder="输入服务访问密钥"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
            />
            <button className="primary-button" disabled={!accessKey}>
              保存密钥
            </button>
          </form>
        </Modal>
      )}
      {dialog === "reset" && (
        <Modal
          title="清空本次调整？"
          subtitle="页面会恢复到刚打开时的状态，你仍然可以通过撤销找回这些改动。"
          onClose={closeDialog}
        >
          <div className="dialog-actions">
            <button className="secondary-button" onClick={closeDialog}>
              继续调整
            </button>
            <button
              className="primary-button"
              onClick={() => {
                history.commit({});
                setCompare(false);
                setDialog(null);
              }}
            >
              清空调整
            </button>
          </div>
        </Modal>
      )}
      {dialog === "leave" && (
        <Modal
          title="先带走本次改动"
          subtitle={`当前有 ${changedNodes.length} 个元素已调整。打开另一个页面后，当前画布会被替换。`}
          onClose={closeDialog}
        >
          <div className="dialog-actions">
            <button className="secondary-button" onClick={closeDialog}>
              继续调整
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setDialog(null);
                void showExport();
              }}
            >
              查看并导出代码
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setDialog(null);
                pendingOpen?.();
                setPendingOpen(null);
              }}
            >
              打开新页面
            </button>
          </div>
        </Modal>
      )}
      {exportResult && (
        <Modal
          title="带走你的改动"
          subtitle={`调整了 ${changedNodes.length} 个元素。${exportResult.files.length ? "原文件的其余代码保持原样。" : exportResult.javascript ? "将 JavaScript 补丁放到原页面脚本中。" : "将 CSS 补丁放到原页面样式的末尾。"}`}
          onClose={closeExport}
          wide
        >
          <div className="export-tabs">
            {exportResult.files.length > 0 && (
              <>
                <button
                  className={exportTab === "source" ? "active" : ""}
                  onClick={() => setExportTab("source")}
                >
                  改后源码
                </button>
                <button
                  className={exportTab === "diff" ? "active" : ""}
                  onClick={() => setExportTab("diff")}
                >
                  最小差异<span>{exportResult.files.length}</span>
                </button>
              </>
            )}
            <button
              className={exportTab === "css" ? "active" : ""}
              onClick={() => setExportTab("css")}
            >
              CSS 补丁
            </button>
            {exportResult.javascript && (
              <button
                className={exportTab === "javascript" ? "active" : ""}
                onClick={() => setExportTab("javascript")}
              >
                JavaScript 补丁
              </button>
            )}
          </div>
          {exportResult.files.length > 0 && exportTab === "source" && (
            <div className="export-file">
              <FileCode2 size={15} />
              <select
                aria-label="导出文件"
                value={exportFile}
                onChange={(event) => setExportFile(Number(event.target.value))}
              >
                {exportResult.files.map((file, index) => (
                  <option key={file.path} value={index}>
                    {file.path}
                  </option>
                ))}
              </select>
              <span>只修改样式属性</span>
            </div>
          )}
          {exportResult.mapped < exportResult.total &&
            exportResult.files.length > 0 && (
              <p className="export-warning">
                部分改动无法直接写回源码，请同时带走
                {exportResult.javascript ? " JavaScript" : " CSS"} 补丁以包含全部改动。
              </p>
            )}
          {exportResult.javascript && exportTab === "css" && (
            <p className="export-warning">
              原页面的重要样式具有更高的层叠优先级，CSS 无法单独覆盖这些属性。
              请使用 JavaScript 补丁。
            </p>
          )}
          <div className="code-preview" tabIndex={0} aria-label="导出代码预览">
            {codeText.split("\n").map((line, index) => (
              <div
                className={`code-line ${exportTab === "diff" ? (line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "context" : "") : ""}`}
                key={index}
              >
                <span className="line-number">{index + 1}</span>
                <code>{line || " "}</code>
              </div>
            ))}
          </div>
          <div className="export-footer">
            <span>
              <Check size={14} />
              {exportTab === "source"
                ? "与原始文件逐字对齐"
                : exportTab === "javascript"
                  ? "覆盖高优先级重要样式，保留其他代码"
                  : exportTab === "diff"
                    ? "仅包含发生改变的部分"
                    : "原有 transform 与样式保持有效"}
            </span>
            <div>
              <button
                className="secondary-button"
                onClick={() =>
                  download(
                    exportTab === "source"
                      ? exportResult.files[exportFile]?.path.split("/").pop() ||
                          "source.txt"
                      : exportTab === "javascript"
                        ? "miweb-adjustments.js"
                        : exportTab === "diff"
                          ? "miweb-changes.patch"
                          : "miweb-adjustments.css",
                    codeText,
                  )
                }
              >
                <Download size={14} />
                下载
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  void copy(codeText)
                    .then(() => notify("代码已复制"))
                    .catch(handleError)
                }
              >
                <Copy size={14} />
                复制
                {exportTab === "source"
                  ? "源码"
                  : exportTab === "javascript"
                    ? "补丁"
                    : exportTab === "diff"
                      ? "差异"
                      : " CSS"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
