export async function api<T>(
  url: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const key = sessionStorage.getItem("miweb-access-key") || "";
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "x-miweb-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data?.error || "操作失败，请重试"), {
      needsKey: data?.needsKey,
    });
  return data;
}

export function download(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copy(text: string) {
  if (!text) throw new Error("没有可复制的改动");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) throw new Error("无法访问剪贴板，请使用下载按钮");
  }
}
