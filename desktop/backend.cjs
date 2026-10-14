"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Set this after the utility process has booted. Passing it to the utility
// process itself would make Electron bypass Chromium's utility-process setup.
// Playwright inherits it when launching its Node subprocess driver.
process.env.ELECTRON_RUN_AS_NODE = "1";

// The existing server owns browser cleanup. A message works on Windows, where
// sending a POSIX signal to a utility process is not a reliable shutdown API.
process.parentPort.on("message", ({ data }) => {
  if (data?.type === "miweb-shutdown") process.emit("SIGTERM");
});

import(pathToFileURL(path.join(__dirname, "..", "server", "index.mjs")).href)
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
