# 微调 Miweb

一个用来微调 AI 生成网页的工作台。打开页面，点选元素，用鼠标或方向键调整位置与尺寸，然后复制代码。

## 开始使用

需要 Node.js 22.12+，推荐 Node.js 24。

```powershell
npm ci
npm run browser:install
npm run dev
```

打开 **http://127.0.0.1:4173**，输入网址或本地项目路径，也可以先点“试用示例”。

生产模式：

```powershell
npm run build
npm start
```

## 接入页面

| 输入 | 预览方式 | 导出结果 |
| --- | --- | --- |
| `https://example.com` | 隔离浏览器加载并渲染当前地址 | 使用原页面选择器的布局补丁 |
| `http://localhost:5173` | 加载已经运行的本地开发页面 | 布局补丁 |
| `D:\projects\my-site` | 只读加载项目，建立源码位置映射 | 修改后的源文件、最小 diff、CSS 补丁 |
| 选择项目文件夹 | 临时导入并预览项目 | 修改后的源文件、最小 diff、CSS 补丁 |

文件夹/目录模式支持普通 HTML，以及具有 `index.html` 入口的 Vite React/JSX/TSX、Vue SFC 项目。默认识别 React、Vue 和 `@/` 别名。**不会执行项目配置文件、npm 脚本，也不会直接修改原项目。** 含自定义插件、其他路径别名、特殊构建或 Next.js 的项目，请先启动它自己的开发服务，再输入 localhost 链接。

其他包依赖需要已安装在被连接项目中。上传文件夹会排除 `node_modules`、`.git`、常见构建产物和 `.env`；因此依赖其他包的上传项目可能无法预览。此时使用本地目录模式或已启动的开发链接。

## 调整与交付

- 点击元素，或者通过元素列表和搜索选择；可选择父元素。
- 拖动元素改变位置，拖动八个控制点改变宽高。
- 方向键移动 1px，Shift + 方向键移动 10px，Alt + 方向键调整宽高。
- 输入 X/Y 偏移、宽高、字号和圆角。
- 撤销/重做、恢复单个元素、清空调整、查看调整前后的变化。
- 桌面、平板、手机宽度预览与画布缩放。
- 一键复制，或预览、复制和下载完整修改后源码 / unified diff / CSS。

**源码模式**以原文件的字符串位置做最小修改：HTML 的 `style` 属性、React 的 `style` 对象、Vue 的静态/绑定样式。保留其他代码、注释、换行和格式，不通过整个文件重新序列化。多个组件实例映射到同一个源元素时会同步调整。

**链接模式**无法反推出构建前的原始 React/Vue 代码，因此导出带有原页面选择器的 CSS 补丁。将补丁放在原样式的末尾。对于不能可靠确定有效样式的属性展开节点，源码模式也会退回 CSS 补丁，并在交付窗口说明。

原页面使用 `!important` 时会额外检查样式优先级。HTML/Vue 源码保留重要声明；React 在内联样式无法可靠覆盖时改用布局补丁。CSS 补丁会提高选择器优先级；若需要覆盖内联重要样式、级联层中的重要声明或过高的选择器优先级，则生成 JavaScript 补丁并明确提示它的使用位置。

Windows 剪贴板可能把换行转换为 CRLF。下载的源码文件和生成的 diff 保留原文件换行，源码导出不会改写未调整的部分。

位移使用独立的 CSS `translate`，保留原有的 `transform`。宽高以 border-box 像素计算。修改默认作用于所有屏幕宽度；不同宽度预览用于检查影响。Flex/Grid、min/max-width、父级裁剪、内联元素等布局约束仍然有效，不会为绕开约束自动重写页面结构。

## 产品边界

- 编辑当前地址的渲染快照，暂停原页面脚本与链接导航；不会操作子页面。
- 不复制用户浏览器的登录态。需要登录、反自动化、Canvas、Shadow DOM、跨域内嵌内容或依赖实时交互的页面，可能无法完整捕获。
- 页面渲染失败时会显示具体错误，保留已有画布和改动。
- 会话保存在服务进程内，默认空闲有效期 120 分钟。改动保存在当前浏览器；服务重启或会话过期后需要重新导入页面。完成调整后应复制或下载代码。
- 原文件由用户在自己的项目中替换或通过 diff 应用。不会自动保存到原项目或部署目标网站。

## 公开部署

这是 **React 前端 + Node.js/Express 服务 + Chromium 渲染器** 的完整网站，需要能够运行 Node.js 和 Chromium 的服务器；单纯静态托管不能完成网页捕获。使用 HTTPS 反向代理，服务端不需要接入 AI 模型或付费 API。

```powershell
$env:HOST = '0.0.0.0'
$env:LOCAL_ACCESS = '0'
$env:MIWEB_ACCESS_KEY = '替换成随机生成的访问密钥'
$env:PUBLIC_ORIGIN = 'https://tune.example.com'
npm start
```

公开监听必须配置访问密钥，界面会要求输入。公开模式禁用本地目录、localhost 和内网访问，仍支持用户选择文件夹上传。公开网站不会自动读取访问者电脑上的目录路径。这里的服务适用于受控用户或团队使用，尚未包含独立用户账号、团队权限、付费和跨服务持久化。

通过 HTTPS 反向代理访问时，需要把 `PUBLIC_ORIGIN` 设置为网站实际的域名；它用于资源链接和请求来源检查。代理应将网站根路径转发到 Node 服务，保留 Host，并为页面加载提供至少 60 秒的接口超时。

迁移到 Ubuntu 时使用随项目提供的 Docker Compose 与 Nginx 配置。完整的打包迁移、HTTPS、上线验收、更新与回滚步骤见 **[Ubuntu 部署文档](docs/ubuntu.md)**。

先将 `deploy/production.env.example` 复制为 `deploy/production.env`，填写随机访问密钥和实际 HTTPS 域名，然后运行：

```sh
docker compose --env-file deploy/production.env up -d --build --wait --wait-timeout 180
curl --fail http://127.0.0.1:4173/api/health
```

Compose 仅将服务端口绑定到服务器的 `127.0.0.1`，公开访问由 HTTPS 反向代理提供。环境变量通过操作系统或容器注入，`.env.example` 仅作参考；服务不会自动读取 `.env`。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `4173` | 网站端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `LOCAL_ACCESS` | 本地监听开启，其他关闭 | 允许 localhost 与本地项目目录 |
| `MIWEB_ACCESS_KEY` | 无 | 服务访问密钥，公开监听时必须设置 |
| `PUBLIC_ORIGIN` | 请求中的地址 | HTTPS 反向代理下的实际网站来源地址 |
| `SESSION_TTL_MINUTES` | `120` | 会话空闲过期时间，范围 5–1440 |
| `CHROMIUM_SANDBOX` | `0` | 设置 `1` 启用 Chromium sandbox，需宿主系统支持 |

抓取时验证每一个网络请求和重定向的 DNS/IP，并将验证地址固定到实际连接。阻止内网、云元数据和保留地址。本机代理使用 `198.18/15` 或 `2001:2::/48` 假地址时，经固定的 TLS 公网 DNS 解析器获取实际公网地址，再执行相同检查。限制抓取并发、请求数量、响应大小、会话数量和缓存字节数。

预览使用无 `allow-same-origin` 的 sandbox iframe 和只允许微调桥接脚本执行的 CSP；原网页脚本被移除。文件夹导入检查路径、大小和敏感文件。服务 API 可使用访问密钥；预览资源只通过随机会话/资源地址读取。

## 验证

```powershell
npm test
npm run test:integration
npm run build
npm run test:e2e
```

单元测试覆盖最小源码修改、动态样式、重复实例、源文件格式保留，以及网络访问边界。集成测试实际启动 Chromium 验证 HTML、React、Vue、JavaScript 内容、重定向、CSS 和项目隔离。E2E 启动独立的生产服务，执行真实鼠标、键盘、复制和下载流程。最终验收结果、容器测试与已知边界见 [QA.md](QA.md)。

主要文件：

- `src/App.tsx`：工作台、选择、属性、撤销、对比与导出。
- `src/Landing.tsx`、`src/dark-gallery.css`：黑色 Apple 产品展示风格首页与分章节入场动效。
- `src/ScrollShowcase.tsx`、`src/scroll-showcase.css`：原生滚动操作演示及减少动态效果支持。
- `src/editor-gallery.css`：真实工作台与弹窗的统一皮肤。
- `src/bridge.js`：隔离画布内的拖动、缩放和键盘控制。
- `server/capture.mjs`：真实页面渲染与安全快照。
- `server/project.mjs`：只读项目预览与临时构建缓存。
- `server/project-css.mjs`：有边界的样式依赖加载与导入条件处理。
- `server/source.mjs`：元素源码定位与最小修改。
- `server/network.mjs`：地址检查、DNS 固定与受限抓取。

实现参考：[Playwright 浏览器上下文](https://playwright.dev/docs/browser-contexts)、[Vite JavaScript API](https://vite.dev/guide/api-javascript)、[MDN iframe sandbox 与同源限制](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)。

## 前端版本与回档

当前前端按用户最新指定的 [Apple iPhone 18 Pro 页面](https://www.apple.com.cn/iphone-18-pro/) 改为整体黑色、分章节滚动叙事，结合 [Impeccable](https://github.com/pbakaus/impeccable) 与 [Taste Skill](https://github.com/leonxlnx/taste-skill)；产品和设计约定分别记录在 `PRODUCT.md`、`DESIGN.md`。动效使用 CSS 视图时间线与 IntersectionObserver，不增加运行时依赖。

改版前的完整前端与截图保存在 [原版备份](design-versions/2026-10-13-original/README.md)。需要回档时先保存当前 `src`，再用备份的 `src` 替换，并按需恢复 `index.html` 和 `examples/atelier/index.html`，然后执行 `npm run build`。后端无需回档。

上一轮白色科技风也单独保存在 [白色版备份](design-versions/2026-10-13-gallery-white/README.md)，可以恢复到该版本。黑色主题只影响编辑器自己的界面，导入网页不会被强制反色。

先前的 `miweb-ubuntu-20261013.tar.gz` 及 `miweb:verify` 镜像保留的是改版前版本；迁移新版请用当前源码重新打包、构建，避免误用旧前端。
