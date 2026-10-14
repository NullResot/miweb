# 开发与构建

面向需要修改 Miweb 或自行构建的开发者。普通使用请直接 [安装桌面版](/guide/install)。

## 环境

需要 Node.js 22.12+，推荐 Node.js 24，以及 Git。Windows 安装包在 Windows x64 环境中构建；macOS 安装包在对应架构的原生 Mac 上构建，需要 macOS 13 Ventura 或更高版本。

```sh
git clone https://github.com/NullResot/miweb.git
cd miweb
npm ci
npm run browser:install
```

`browser:install` 安装用于页面捕获的 Playwright Chromium。源码运行需要自己安装运行依赖；发布的桌面安装包包含所需渲染器。

## 运行桌面版

```sh
npm run desktop:dev
```

这条命令先构建工作台，再启动 Electron。桌面主进程启动仅监听本机的预览服务，并提供系统文件夹选择。退出应用时，本机服务一并退出。

macOS 关闭窗口后，应用与本机服务仍留在后台；点击 Dock 中的 Miweb 可重新打开窗口。使用“Miweb → 退出 Miweb”或 ⌘ + Q 完全退出。

## 打包 Windows 安装包

```sh
npm run desktop:dist:win
```

命令依次构建工作台、准备 Chromium，再生成 x64 安装包。浏览器准备阶段可能需要下载文件，请保持网络可用。

如果只需要验证可运行目录，使用：

```sh
npm run desktop:pack
```

打包配置位于 `electron-builder.config.cjs`，结果输出到 `release`，安装包名称为 `Miweb-Setup-x64.exe`。发布前应在目标系统验证生成的安装包，而不是只检查源码开发窗口。

## 打包 macOS 安装包

在 Apple 芯片或 Intel Mac 上执行：

```sh
npm run desktop:dist:mac
```

命令为当前机器架构构建工作台、准备对应的 Chromium，再生成 DMG 和 ZIP。Apple 芯片输出 `release/Miweb-mac-arm64.dmg`，Intel 输出 `release/Miweb-mac-x64.dmg`。

如果只需要验证可运行的 `.app` 目录，使用：

```sh
npm run desktop:pack:mac
```

Chromium 与 Electron 应用必须使用相同架构，请在对应的原生 macOS 环境中分别构建 arm64 和 x64，不要将另一种架构或 Windows 的浏览器文件放入安装包。

默认使用临时签名（ad-hoc），没有 Developer ID 签名或 Apple 公证。它不能消除用户首次打开时的 Gatekeeper 提示，处理方式见 [安装说明](/guide/install#macos-首次打开被拦截)。正式发布前应验证两种架构的安装、启动、项目预览和页面捕获。

## 浏览器开发入口

```sh
npm run editor:dev
```

打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)。源码版仍保留本地浏览器开发入口，便于调试工作台和服务。

生产构建：

```sh
npm run build
npm run server:start
```

## 构建文档

```sh
npm run docs:dev
npm run docs:build
```

文档源文件位于 `docs/site`，默认生产路径是 `/miweb/`，用于 [GitHub Pages 文档](https://nullresot.github.io/miweb/)。文档构建结果是静态文件，与桌面编辑器的本机服务分开。

在网站根路径预览文档时，可设置 `MIWEB_DOCS_BASE=/`；正式 Pages 构建使用默认路径。

## 验证

```sh
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run docs:build
```

单元测试覆盖源码修改与网络边界；集成测试实际启动 Chromium；E2E 执行真实鼠标、键盘、复制与下载流程。发布前还需验证桌面安装、启动、目录选择和退出时的服务生命周期。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `src/App.tsx` | 工作台、选择、属性、历史、对比与导出 |
| `src/bridge.js` | 隔离画布中的拖动、缩放和键盘控制 |
| `desktop/main.cjs` | 桌面窗口、本机服务生命周期与原生目录选择 |
| `desktop/preload.cjs` | 受限的桌面能力桥接 |
| `scripts/stage-browser.mjs` | 准备打包所需的 Chromium |
| `electron-builder.config.cjs` | Windows 与 macOS 安装包配置 |
| `server/index.mjs` | 本机预览服务与接口 |
| `server/capture.mjs` | 页面渲染与安全快照 |
| `server/project.mjs` | 只读项目预览与临时构建 |
| `server/source.mjs` | 源码关联与局部修改 |
| `server/network.mjs` | 地址检查与受限网络请求 |
| `docs/site` | VitePress 文档源文件 |
| `tests` | 单元、集成和浏览器测试 |

## 提交修改

提交前运行与改动相关的验证。UI 变更应检查实际工作台和不同预览宽度；源码导出变更应确认未调整部分的格式仍然保留。

通过 [GitHub Issues](https://github.com/NullResot/miweb/issues) 报告问题或讨论功能，通过 Pull Request 提交代码。说明问题、修改后的行为与验证方式，避免在示例或日志中包含私人项目内容。
