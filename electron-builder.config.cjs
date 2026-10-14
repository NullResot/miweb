/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'cn.miweb.desktop',
  productName: 'Miweb',
  asar: false,
  forceCodeSigning: false,
  npmRebuild: false,
  electronDist: 'node_modules/electron/dist',
  directories: {
    output: 'release',
    buildResources: 'desktop/assets',
  },
  extraMetadata: {
    main: 'desktop/main.cjs',
  },
  files: [
    'desktop/**/*',
    'server/**/*',
    'src/bridge.js',
    'dist/**/*',
    'examples/atelier/**/*',
    'package.json',
    '!**/.env',
    '!**/.env.*',
  ],
  extraResources: [
    {
      from: 'desktop-resources/browsers',
      to: 'browsers',
      filter: ['**/*'],
    },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'desktop/assets/icon.ico',
    executableName: 'Miweb',
  },
  mac: {
    // Build on each native Mac architecture so Electron and the bundled browser
    // always match. The CLI defaults to the build machine's architecture.
    target: ['dmg', 'zip'],
    artifactName: 'Miweb-mac-${arch}.${ext}',
    icon: 'desktop/assets/icon.icns',
    executableName: 'Miweb',
    category: 'public.app-category.developer-tools',
    minimumSystemVersion: '13.0.0',
    // Ad-hoc signing makes the ARM binaries executable without claiming a
    // Developer ID. Hardened library validation requires a Developer ID or
    // extra entitlements; these releases have no notarization credentials.
    identity: '-',
    hardenedRuntime: false,
    notarize: false,
  },
  dmg: {
    artifactName: 'Miweb-mac-${arch}.${ext}',
    sign: false,
  },
  nsis: {
    artifactName: 'Miweb-Setup-${arch}.${ext}',
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    packElevateHelper: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Miweb',
    uninstallDisplayName: 'Miweb',
    runAfterFinish: true,
  },
  publish: null,
};
