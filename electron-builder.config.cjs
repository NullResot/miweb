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
