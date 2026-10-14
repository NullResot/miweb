# Miweb 验收记录

验证日期：2026-10-13 至 2026-10-14。当前版本为 Apple 黑色滚动叙事改版。功能与界面以生产构建和实际 Chromium 操作为依据；下方 Linux 记录属于更早的部署基线。测试通过说明下列范围已验证，不代表任意网站、浏览器或服务器都没有问题。

## 最终检查

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| npm test | 28/28 通过，0 跳过 | 源码最小修改、CSS 依赖、网络边界 |
| npm run test:integration | 20/20 通过，0 跳过 | 实际 Chromium 捕获、导出复现、项目隔离；包括 6 个级联层子用例 |
| npm run build | 通过 | TypeScript 与生产资源构建 |
| npm run test:e2e | 24/24 通过，0 失败、0 跳过、0 flaky，82.24 秒；后续6项专项再次通过 | 原有21项，加深色界面、各章节实际滚动变化、全部章节reduce模式3项 |
| Lighthouse 13.5.0 | 黑色版性能91、可访问性100、最佳实践100 | 本机移动端模拟；LCP 2.8s、CLS 0、TBT 30ms，不是公网测量 |
| Linux Compose 与 HTTPS/Nginx | 改版前版本通过，exit 0；本轮没有重建容器 | 非 root Chromium、访问控制、导入/导出、公网网址、HTTPS 代理 |

## 本轮前端改版

- 参考用户最新给定的Apple iPhone 18 Pro页面：首页、工作台、属性面板、导出弹窗和内置示例统一黑色/深灰、冷白字阶及蓝色操作强调。
- Hero随滚动展平与放大；过渡文字、源码标题、差异面板、两种交付方式、收尾标题与入口分别入场，原有核心演示继续保留。
- 原生滚动演示验证实际上移12px、增宽24px；支持步骤按钮、方向键、Home/End、返回滚动和减少动态效果。
- 手机画布为浮动工具栏预留54px；测试已移除首轮规避遮挡的预先滚动，直接点选、微调和复制均通过。
- 新版辅助导航与说明提升为至少13px，代码/产品UI内部真实字号保留。最后将屏幕外待入场内容由极低透明度改为透明，进入视口或获得键盘焦点后显示；减少动态效果直接完整显示。6项专项再次通过。
- 未新增运行时依赖，首页没有第三方字体或图片请求；移除了Google Fonts远程导入。
- 最初版本8个src文件、白色版13个src文件与各自SHA256清单均一致；备份分别位于 design-versions/2026-10-13-original、design-versions/2026-10-13-gallery-white，含截图、入口/依赖文件与示例。
- 性能数值是本机模拟结果，不代表真实公网体验；未进行Firefox/WebKit和真实触摸设备测试。

## 核心行为

- 鼠标点选、元素列表/搜索、选择父元素；拖动移动与八个方向的缩放控制点。
- 方向键移动 1px，Shift 移动 10px，Alt 调整尺寸；非 100% 画布缩放时仍使用页面实际像素。
- X/Y、宽高、字号、圆角；撤销/重做、恢复单元素、清空调整、调整前后对比。
- 当前地址的脚本生成内容、重定向、CSSOM 样式、图片、字体和动态表单状态。
- 本地 HTML、Vite React/JSX/TSX、Vue SFC 的目录或文件夹导入；实际从导出的 React/Vue 源码重新渲染，确认宽高和位移。
- HTML 属性、React 样式对象、Vue 静态/动态样式的局部修改；保留无关代码、注释、Unicode 与原换行，不写回原文件。
- 1000 个组件实例同步调整、只修改一处对应源码；混合映射与多文件交付计数正确。
- 数字输入聚焦期间保留草稿，不被画布异步尺寸覆盖；已复现并修复输入 180 被旧尺寸拼接后裁成 10000 的问题，加入确定性回归。
- 复制源码、布局补丁、下载 diff；多文件修改会打开交付窗口，用户选择文件或复制 diff。
- 刷新恢复当前有效会话和改动；打开另一页面前提示未带走的改动；失败保留已有画布。
- 会话每分钟保活，返回首页后停止；响应式画布和工作台界面。

## 已覆盖的异常与边界

- 错误网址、无法访问的站点、长时间占用渲染器的脚本；超时后可继续加载正常页面。
- JSX shorthand、重复属性、计算属性、spread、动态表达式和尾部注释；Vue 引号/实体、属性内的大于号；HTML 内联 CSS 中的数据 URL 与分号。
- 重要声明、极高选择器优先级和级联层；需要时导出可运行的 JavaScript 补丁，避免给出实际无法覆盖的 CSS。
- 页面自带或错配的源码标记不会造成虚假的组件实例关联。
- 预览使用 opaque-origin sandbox 与 CSP；原页面脚本和导航被禁用。选中框与控制点使用 Shadow DOM，避免被目标页全局样式覆盖。
- 访问密钥、Origin/Host 检查、公开部署禁用本地路径和私网；DNS/IP 固定、重定向复查、响应体大小限制。
- 上传路径穿越和敏感文件拒绝；不执行项目 Vite/Babel/PostCSS 配置，不暴露服务端 VITE 环境变量。
- 公开模式下上传项目只能请求自身预览服务，不能访问其他本机服务。
- 嵌套 CSS import、layer/supports/media 条件、相对资源、远程 CSS、循环依赖；CSS Modules 的组合样式与变量依赖不得读出项目边界。

## 浏览器与容器证据

浏览器测试使用 Windows 上的 Chromium 和独立生产服务。报告与截图由测试生成：

黑色版完整浏览器回归开始于2026-10-13北京时间23:51:07，24项全部通过。最后一批文字/可访问性调整后，6项专项再次通过（20.8秒）。已查看1440px、768px与390px首页、叙事章节、演示过程、源码章节、真实编辑器和导出界面，未发现主要控件裁切或文档横向溢出。普通鼠标滚轮已观察到连续动画，按钮操作也验证了最终静态状态。

Taste Skill浏览器检查在三种宽度均测得17个运动元素、0横向溢出；最终无FAIL，保留输入框边界、响应式字阶及只使用自有界面片段这三项风格WARN。该工具的外部录像要求使用no-footage例外：产品演示本身是原生可交互动画，维持轻量，不以无关素材填充。Impeccable detector输出为空。原始报告保存在test-results/dark-inspect-final/report.json，不将审美规则例外等同于通用合规认证。

- test-results/e2e.json：最终用例结果和耗时。
- test-results/browser-report/index.html：可打开的测试报告。
- test-results/landing-desktop.png、editor-desktop.png、export-desktop.png：首页、编辑器、交付窗口。
- test-results/viewport-1024.png、viewport-390.png：1024×768、390×844 界面。
- test-results/gallery-final-home-desktop.png、gallery-final-home-mobile.png：本轮首页。
- test-results/gallery-final-demo-desktop.png、gallery-final-editor-desktop.png、gallery-final-editor-mobile.png：本轮演示和工作台。
- test-results/gallery-lighthouse.json：上一轮白色版移动端模拟报告。
- test-results/dark-home-desktop.png、dark-home-mobile.png、dark-demo-desktop.png、dark-source-desktop.png、dark-editor-desktop.png、dark-export-desktop.png：本轮黑色版截图。
- test-results/dark-lighthouse.json、dark-inspect-final/report.json：黑色版性能/可访问性与三种视口设计检查。

Linux 测试使用 Docker Desktop 的 Linux 引擎和仓库中的实际 compose.yaml。容器内为 Node.js 24、非 root UID 1000、Chromium；验证只读根文件系统与配置的资源限制。测试项目使用独立名称和临时端口，完成后清理自己的容器与网络。

改版前容器验收完成于北京时间 20:26:22。镜像 miweb:verify 的 ID 为 sha256:83cd602ac63847e71cffaaabbb041b48932dd020093f222a504a433eb36c2a27，当时容器文件与工作区逐项一致，包含数字输入修复。此镜像不包含后来完成的苹果科技风前端；部署新版时需重新构建。详细环境、结果和当时的校验值见 [容器验证记录](deploy/verification-20261013.json)。临时测试容器、网络和证书均已清理，验证镜像保留。

本机生产预览的健康接口和首页均返回 HTTP 200；HTML 及其全部 JS/CSS 资源与最终 dist 文件逐字节一致。

HTTPS 测试使用原 deploy/nginx.conf、临时受信任自签名证书和 127.0.0.1:4173 上游，实际执行首页、访问控制、捕获与导出。它不等于真实域名证书已经上线。

重现容器检查（需要 Docker；HTTPS 测试还需要 OpenSSL）：

    node tests/docker-smoke.mjs --build --image=miweb:verify --url=https://example.com
    node deploy/check-nginx.mjs --proxy --image=miweb:verify

## 交付边界

- 尚未在用户的实际 Ubuntu 主机部署，公网 DNS、真实 CA 证书和实际业务页面需要按 [Ubuntu 文档](docs/ubuntu.md) 上线验收。
- 浏览器交互矩阵目前为 Chromium，未进行 Firefox/WebKit 或真实手机触摸设备验收。
- URL 只能提供渲染后的页面和布局补丁，不能从打包后的网页还原原始 React/Vue 工程。源码对齐需要提供受支持的源项目。
- 不复制登录态；反自动化、Canvas、Shadow DOM、跨域内嵌内容和实时交互可能无法完整捕获。自定义构建插件、预处理器、SSR 等复杂项目需运行自己的服务后接入可访问的网址。
- 公开服务器不能读取访问者电脑的路径或 localhost；使用文件夹上传，或在该电脑运行 Miweb。
- 会话存于单个服务进程，重启/过期后需重新导入；浏览器改动缓存不等于服务端永久保存。没有独立账户、团队权限和多副本持久化。
- 此次未做生产级并发压力测试；容器的 CPU/内存限制是运行配置，不是吞吐容量承诺。


## Desktop and static documentation migration (2026-10-14)

The public website is now the VitePress documentation site at https://nullresot.github.io/miweb/. The source remains in this repository; the editor is delivered through a Windows x64 Electron installer. GitHub Pages publishes only static documentation, not a Node/Chromium service.

Verified before release:

- 33 unit tests passed, including desktop frame/API trust and Windows canonical project-path cases.
- 20 Chromium integration tests passed. Project aliases resolve correctly; child directory links cannot escape the allowed project root.
- 24 browser E2E tests passed for selection, resizing, history, imports, source/patch export and responsive behavior. Desktop URL normalization is additionally covered by the packaged desktop smoke test.
- Development and unpacked desktop smoke tests passed: authenticated random loopback server, sandboxed renderer, original-source export/clipboard, patch download, native directory picker, local URL snapshots, denied popup/navigation and shutdown cleanup.
- Static docs built successfully. All 9 public pages were inspected at desktop/mobile widths; navigation, Chinese local search and search-result links worked without document overflow, resource errors or script exceptions.
- The GitHub Windows runner exposed a realpath-versus-raw-root mismatch for short/case-aliased temporary directories. It was reproduced locally and fixed before the v0.2.0 release; the release workflow's Windows unit gate passed.

Release gate: the tagged GitHub Actions workflow must build, pass integration and packaged desktop tests, and publish the installer with SHA256SUMS.txt. Completion additionally requires downloading that exact release asset, verifying its hash, and testing actual installation/launch/uninstall. Evidence for those final steps is appended after they finish; the older pre-redesign Ubuntu archive and images are not release evidence for the desktop app.

The Windows package is not code-signed; SmartScreen/unknown-publisher prompts are documented. macOS/Linux installers have not been published. Development-tool advisories are not equivalent to runtime findings; the current npm production-only dependency audit reports zero known advisories, not a guarantee of security.


Final v0.2.1 release verification completed:

- Tagged workflow https://github.com/NullResot/miweb/actions/runs/38558457323 succeeded: 33 Windows units, 20 integrations, installer build, 7 actual packaged desktop checks, and public Release upload. The compact-window smoke selector was corrected to use the home action's title, which remains visible when the English brand text is hidden.
- Downloaded the published `Miweb-Setup-x64.exe` (219,203,516 bytes). SHA256 matched `SHA256SUMS.txt` and GitHub's asset digest: `a269ae5d627089bf2d6648f29688d1116f573a624c359a44bc456703763a266e`. The stable `releases/latest/download` URL is accessible anonymously with HTTP 200.
- Ran the real installer into an isolated workspace test directory. Installation exited 0 and created valid desktop/start-menu shortcuts. Installed backend/shell source files matched the release commit after newline normalization.
- Ran all 7 desktop smoke checks against the installed executable with system Node removed from PATH. Additionally verified React and Vue project compilation/source export, and importing the public GitHub Pages documentation URL in that installed app. No separately installed Node runtime or system Playwright cache was used by the app.
- Ran the real uninstaller. Final state confirms executable, installation directory, desktop shortcut and start-menu shortcut are removed. The installer launcher exits before its cleanup helper; verification waited for final filesystem state rather than treating the launcher's exit alone as completion.
- Public documentation workflow https://github.com/NullResot/miweb/actions/runs/38558457469 succeeded; the 9-page desktop/mobile public-site checks and search/navigation checks also passed.

Machine-readable final evidence is in [desktop-verification-20261014.json](docs/desktop-verification-20261014.json). The local installer at `release/Miweb-Setup-x64.exe` is the verified GitHub release asset; the earlier local unpacked debug build is not the release deliverable.
