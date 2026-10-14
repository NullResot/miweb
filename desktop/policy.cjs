"use strict";

function sameOrigin(url, origin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isAppPage(url, origin) {
  return sameOrigin(url, origin) && new URL(url).pathname === "/";
}

function canAuthenticateRequest(request, trust) {
  return (
    request.webContentsId === trust.webContentsId &&
    request.isMainFrame === true &&
    isAppPage(request.frameUrl, trust.origin) &&
    sameOrigin(request.url, trust.origin) &&
    new URL(request.url).pathname.startsWith("/api/")
  );
}

function canUsePicker(request, trust) {
  return (
    request.webContentsId === trust.webContentsId &&
    request.isMainFrame === true &&
    isAppPage(request.frameUrl, trust.origin)
  );
}

function isExportDownload(url, origin) {
  return url.startsWith(`blob:${origin}/`);
}

module.exports = {
  sameOrigin,
  isAppPage,
  canAuthenticateRequest,
  canUsePicker,
  isExportDownload,
};
