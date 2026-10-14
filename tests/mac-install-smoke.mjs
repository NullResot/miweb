import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const resultsPath = path.join(root, "test-results");
const reportPath = path.resolve(process.env.MAC_INSTALL_REPORT || path.join(resultsPath, "mac-install-smoke.json"));
const expectedArchitecture = process.env.MAC_APP_ARCH || process.arch;
const checks = [];
const report = {
  schemaVersion: 1,
  kind: "mac-dmg-installation-smoke",
  ok: false,
  platform: process.platform,
  hostArchitecture: process.arch,
  expectedArchitecture,
  osRelease: os.release(),
  checks,
  cleanup: { detached: false, installationRemoved: false },
};
let temporary;
let mountpoint;
let attachAttempted = false;
let failure;

function checked(message) {
  checks.push(message);
  console.log(`PASS ${message}`);
}

// Every command uses a fixed executable and an argument array. DMG paths and
// bundle names never become shell syntax, and no system security settings are
// changed. In particular this test neither deletes quarantine nor disables
// Gatekeeper to make the application launch.
function command(executable, args, { input, allowFailure = false, timeout = 60000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { cwd: root, env, timeout, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const result = { code: error ? (Number.isInteger(error.code) ? error.code : null) : 0, stdout, stderr };
      if (error && !allowFailure) {
        error.message += `\n${stdout}\n${stderr}`;
        reject(error);
      } else {
        if (error) result.error = error.message;
        resolve(result);
      }
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function plistToJson(xml) {
  const result = await command("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", "-"], { input: xml });
  return JSON.parse(result.stdout);
}

function contained(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function mountedAt(target) {
  const result = await command("/usr/bin/hdiutil", ["info", "-plist"]);
  const info = await plistToJson(result.stdout);
  return (info.images || []).flatMap((image) => image["system-entities"] || [])
    .some((entity) => entity["mount-point"] && path.resolve(entity["mount-point"]) === target);
}

async function detachImage() {
  assert.ok(contained(temporary, mountpoint), "Only the known test mountpoint may be detached.");
  if (!(await mountedAt(mountpoint))) return;
  let lastResult;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    lastResult = await command("/usr/bin/hdiutil", ["detach", mountpoint], { allowFailure: true });
    if (lastResult.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // The read-only test image is the sole target; this never detaches other
  // volumes. Retry after the installed application and its backend have exited.
  lastResult = await command("/usr/bin/hdiutil", ["detach", "-force", mountpoint], { allowFailure: true });
  assert.equal(lastResult.code, 0, `Could not detach the test image: ${lastResult.stderr}`);
}

async function sha256(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function findHeadlessShell(directory, depth = 0) {
  if (depth > 5) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isFile() && ["headless_shell", "chrome-headless-shell"].includes(entry.name)) matches.push(filename);
    if (entry.isDirectory()) matches.push(...await findHeadlessShell(filename, depth + 1));
  }
  return matches;
}

async function architectures(executable) {
  const result = await command("/usr/bin/lipo", ["-archs", executable]);
  return result.stdout.trim().split(/\s+/);
}

try {
  assert.equal(process.platform, "darwin", "DMG installation smoke must run on macOS.");
  assert.ok(["arm64", "x64"].includes(expectedArchitecture), "MAC_APP_ARCH must be arm64 or x64.");
  assert.equal(process.arch, expectedArchitecture, "Run the installer smoke on the matching native architecture.");
  assert.ok(process.env.MAC_DMG_PATH, "Set MAC_DMG_PATH to the packaged Miweb DMG.");
  const dmgPath = await realpath(path.resolve(process.env.MAC_DMG_PATH));
  assert.equal(path.extname(dmgPath).toLowerCase(), ".dmg");
  const dmgStat = await stat(dmgPath);
  assert.ok(dmgStat.isFile() && dmgStat.size > 0, "Expected a nonempty DMG file.");
  report.dmg = { path: dmgPath, bytes: dmgStat.size, sha256: await sha256(dmgPath) };
  report.macOS = (await command("/usr/bin/sw_vers", ["-productVersion"])).stdout.trim();

  await mkdir(resultsPath, { recursive: true });
  // Mount and install inside the workspace, never /Applications or /Volumes.
  // realpath also makes cleanup checks unambiguous on macOS path aliases.
  temporary = await realpath(await mkdtemp(path.join(resultsPath, "mac-install-work-")));
  const canonicalResults = await realpath(resultsPath);
  assert.ok(contained(canonicalResults, temporary));
  mountpoint = path.join(temporary, "dmg-mount");
  const installation = path.join(temporary, "installed");
  await mkdir(mountpoint);
  await mkdir(installation);
  assert.equal(await mountedAt(mountpoint), false);
  attachAttempted = true;
  const attach = await command("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mountpoint, "-plist", dmgPath]);
  const mountInfo = await plistToJson(attach.stdout);
  const volumes = (mountInfo["system-entities"] || []).filter((entity) => entity["mount-point"]);
  assert.equal(volumes.length, 1, "The Miweb DMG should have one mounted filesystem.");
  assert.equal(path.resolve(volumes[0]["mount-point"]), mountpoint);
  const entries = await readdir(mountpoint, { withFileTypes: true });
  const bundles = entries.filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  assert.equal(bundles.length, 1, "Expected exactly one application bundle in the DMG.");
  const sourceBundle = await realpath(path.join(mountpoint, bundles[0].name));
  assert.ok(contained(mountpoint, sourceBundle), "The source app must be contained in the mounted image.");
  const installedBundle = path.join(installation, bundles[0].name);
  await command("/usr/bin/ditto", [sourceBundle, installedBundle], { timeout: 120000 });
  assert.ok(contained(temporary, await realpath(installedBundle)));
  checked("The final DMG mounts read-only and its app installs into an isolated workspace folder.");

  const info = JSON.parse((await command("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(installedBundle, "Contents", "Info.plist")])).stdout);
  assert.equal(info.CFBundleIdentifier, "cn.miweb.desktop");
  assert.equal(info.CFBundleExecutable, "Miweb");
  assert.ok(/^13\./.test(info.LSMinimumSystemVersion), "The app must declare its macOS 13 minimum.");
  const executable = path.join(installedBundle, "Contents", "MacOS", info.CFBundleExecutable);
  assert.ok((await stat(executable)).mode & 0o111, "The installed app executable must preserve its executable permission.");
  const expectedMachArchitecture = expectedArchitecture === "x64" ? "x86_64" : "arm64";
  const electronArchitectures = await architectures(executable);
  assert.deepEqual(electronArchitectures, [expectedMachArchitecture]);
  const browsersPath = path.join(installedBundle, "Contents", "Resources", "browsers");
  const headlessShells = await findHeadlessShell(browsersPath);
  assert.equal(headlessShells.length, 1, "Expected one bundled headless Chromium executable.");
  const browserArchitectures = await architectures(headlessShells[0]);
  assert.deepEqual(browserArchitectures, [expectedMachArchitecture]);
  const iconFilename = info.CFBundleIconFile.endsWith(".icns") ? info.CFBundleIconFile : `${info.CFBundleIconFile}.icns`;
  assert.equal((await readFile(path.join(installedBundle, "Contents", "Resources", iconFilename))).subarray(0, 4).toString("ascii"), "icns");
  report.bundle = {
    path: installedBundle,
    id: info.CFBundleIdentifier,
    version: info.CFBundleShortVersionString,
    minimumSystemVersion: info.LSMinimumSystemVersion,
    electronArchitectures,
    browserArchitectures,
    iconFilename,
  };
  checked("Installed Info.plist, ICNS icon, Electron and bundled Chromium match the requested native architecture.");

  const verification = await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", installedBundle]);
  const signature = await command("/usr/bin/codesign", ["--display", "--verbose=4", installedBundle]);
  const signatureText = signature.stdout + signature.stderr;
  assert.match(signatureText, /Signature=adhoc|Authority=Developer ID Application:/, "Expected an ad-hoc or Developer ID signed app.");
  const gatekeeper = await command("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", installedBundle], { allowFailure: true, timeout: 120000 });
  const quarantine = await command("/usr/bin/xattr", ["-p", "com.apple.quarantine", installedBundle], { allowFailure: true });
  const dmgQuarantine = await command("/usr/bin/xattr", ["-p", "com.apple.quarantine", dmgPath], { allowFailure: true });
  report.signing = {
    verified: true,
    verification: verification.stdout + verification.stderr,
    signature: signatureText,
    adHoc: /Signature=adhoc/.test(signatureText),
    gatekeeper: { accepted: gatekeeper.code === 0, exitCode: gatekeeper.code, output: gatekeeper.stdout + gatekeeper.stderr },
    appQuarantine: quarantine.code === 0 ? quarantine.stdout.trim() : null,
    dmgQuarantine: dmgQuarantine.code === 0 ? dmgQuarantine.stdout.trim() : null,
    securitySettingsChanged: false,
    firstDownloadLaunchVerified: false,
    limitation: "CI copies a local build and starts its executable directly. This does not verify Finder's first launch of a quarantined Internet download. Ad-hoc signing is not Developer ID notarization.",
  };
  checked("Installed bundle signature verifies; Gatekeeper assessment and existing quarantine state are recorded without changing security settings.");

  const nodeEnvironment = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete nodeEnvironment.NODE_OPTIONS;
  const nodeProbe = await command(executable, ["-e", "console.log(JSON.stringify({node:process.versions.node,platform:process.platform,architecture:process.arch}))"], { env: nodeEnvironment });
  const embeddedNode = JSON.parse(nodeProbe.stdout.trim());
  assert.equal(embeddedNode.platform, "darwin");
  assert.equal(embeddedNode.architecture, expectedArchitecture);
  assert.ok(embeddedNode.node);
  report.embeddedNode = embeddedNode;
  checked("The copied app runs its embedded Node runtime with no separate Node installation.");

  const desktopReportPath = path.join(resultsPath, "mac-installed-desktop.json");
  const desktopEnvironment = { ...process.env, DESKTOP_EXECUTABLE: executable, DESKTOP_SMOKE_REPORT: desktopReportPath };
  delete desktopEnvironment.ELECTRON_RUN_AS_NODE;
  delete desktopEnvironment.NODE_OPTIONS;
  const desktop = await command(process.execPath, [path.join(root, "tests", "desktop-smoke.mjs")], { env: desktopEnvironment, timeout: 300000 });
  process.stdout.write(desktop.stdout);
  process.stderr.write(desktop.stderr);
  const desktopReport = JSON.parse(await readFile(desktopReportPath, "utf8"));
  assert.equal(desktopReport.ok, true);
  assert.equal(desktopReport.runtime.packaged, true);
  assert.equal(desktopReport.runtime.architecture, expectedArchitecture);
  assert.equal(await realpath(desktopReport.runtime.executable), await realpath(executable));
  assert.ok(contained(installedBundle, desktopReport.runtime.appPath), "The test must use the installed app's resources.");
  report.desktop = desktopReport;
  checked("The app copied from the DMG passes real imports, edits, clipboard/export, picker, URL, sandbox and graceful shutdown smoke.");
  const postRuntimeSignature = await command("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", installedBundle]);
  report.signing.postRuntimeVerified = true;
  report.signing.postRuntimeVerification = postRuntimeSignature.stdout + postRuntimeSignature.stderr;
  checked("The installed app signature remains valid after project compilation, capture and shutdown.");
  report.ok = true;
} catch (error) {
  failure = error;
  report.error = error.stack || error.message;
} finally {
  // A failed attach can still leave a volume behind. Inspect this exact test
  // mountpoint and detach in finally; never recursively remove a mounted tree.
  if (attachAttempted) {
    try {
      await detachImage();
      assert.equal(await mountedAt(mountpoint), false);
      report.cleanup.detached = true;
    } catch (error) {
      report.ok = false;
      report.cleanup.error = error.stack || error.message;
      failure ||= error;
    }
  }
  if (temporary && (!attachAttempted || report.cleanup.detached)) {
    try {
      assert.ok(contained(await realpath(resultsPath), temporary));
      await rm(temporary, { recursive: true, force: true });
      report.cleanup.installationRemoved = true;
    } catch (error) {
      report.ok = false;
      report.cleanup.error = error.stack || error.message;
      failure ||= error;
    }
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

if (failure) throw failure;
