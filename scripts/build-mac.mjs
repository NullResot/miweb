import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('macOS 安装包需要在 Mac 上构建；仓库的 GitHub Actions 会分别构建 Apple 芯片和 Intel 版本。');
if (!['arm64', 'x64'].includes(process.arch)) throw new Error('仅支持 Apple 芯片 arm64 和 Intel x64。');
if (process.argv.slice(2).some((argument) => argument !== '--dir')) throw new Error('仅支持 --dir；安装包使用当前 Mac 的原生架构，保证内置 Chromium 与应用一致。');
const require = createRequire(import.meta.url);
const cli = (packageName, relativePath) => path.join(path.dirname(require.resolve(`${packageName}/package.json`)), relativePath);
const tasks = [
  [cli('typescript', 'bin/tsc'), '-b'],
  [cli('vite', 'bin/vite.js'), 'build'],
  [path.resolve('scripts/stage-browser.mjs')],
  [cli('electron-builder', 'cli.js'), '--config', 'electron-builder.config.cjs', '--mac', `--${process.arch}`, '--publish', 'never', ...(process.argv.includes('--dir') ? ['--dir'] : [])],
];
for (const args of tasks) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
