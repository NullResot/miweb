# 安装桌面版

Miweb 桌面版将编辑器、项目预览服务和页面渲染器放在一起。普通使用不需要安装 Node.js、浏览器插件或提供 API Key。

## Windows

支持 Windows 10 / 11，64 位（x64）。

<a class="download-link" href="https://github.com/NullResot/miweb/releases/latest/download/Miweb-Setup-x64.exe">下载 Windows 安装包</a>

1. 从本项目的 [GitHub Releases](https://github.com/NullResot/miweb/releases/latest) 下载 `Miweb-Setup-x64.exe`。
2. 运行安装包，一键安装到当前用户目录，无需另外安装运行环境。
3. 从开始菜单或桌面快捷方式打开 Miweb。
4. 点击“试用示例”，先完成一次选中、移动和导出。

安装完成后会启动 Miweb，并创建桌面与开始菜单快捷方式。安装包包含网页渲染器，文件体积会比纯界面程序大。安装后可直接预览本地项目；打开远程网页仍需要网络连接。

### Windows 提示未知发行者

当前安装包尚未使用商业代码签名证书，Windows 可能显示“未知发行者”或 SmartScreen 提示。请确认下载来自本项目 Releases，并核对发布页提供的文件校验值，再决定是否继续安装。

不要从不明镜像或聊天附件下载安装包；若文件来源或校验结果不一致，请停止安装并通过 [GitHub Issues](https://github.com/NullResot/miweb/issues) 反馈。

## macOS

需要 macOS 13 Ventura 或更高版本，分别提供 Apple 芯片（arm64）和 Intel（x64）安装包。

<a class="download-link" href="https://github.com/NullResot/miweb/releases/latest/download/Miweb-mac-arm64.dmg">下载 Apple 芯片版</a>
<a class="download-link" href="https://github.com/NullResot/miweb/releases/latest/download/Miweb-mac-x64.dmg">下载 Intel 版</a>

打开屏幕左上角的苹果菜单 →“关于本机”。如果显示“芯片”，选择 Apple 芯片版；如果显示“处理器”并标有 Intel，选择 Intel 版。可参考 [Apple 的机型识别说明](https://support.apple.com/zh-cn/116943)。

1. 从本项目 [GitHub Releases](https://github.com/NullResot/miweb/releases/latest) 下载对应的 `Miweb-mac-arm64.dmg` 或 `Miweb-mac-x64.dmg`。
2. 双击打开 DMG，将 `Miweb.app` 拖入窗口里的 `Applications`（应用程序）文件夹。
3. 拷贝完成后，在访达侧边栏推出 Miweb 磁盘映像。
4. 从“应用程序”打开 Miweb，点击“试用示例”完成一次调整。

安装包内置对应架构的页面渲染器，无需另装 Node.js 或 Chromium。请使用与 Mac 处理器对应的安装包。

### macOS 首次打开被拦截

当前应用仅使用临时签名（ad-hoc），没有 Developer ID 签名，也未经过 Apple 公证。因此，macOS 可能提示无法验证开发者或无法检查应用是否包含恶意软件。

请先确认文件来自本项目 Releases，并核对发布页的 SHA-256 校验值。**只有在确认来源可信且文件未被篡改后，才考虑允许这个应用打开。**

- 在较旧的 macOS 上，可以在“应用程序”中按住 Control 点按 Miweb，选择“打开”，再确认。步骤见 [Apple 的 macOS Sonoma 使用手册](https://support.apple.com/zh-cn/guide/mac-help/mh40616/14.0/mac/14.0)。
- 如果仍被拦截，先尝试打开一次 Miweb，再前往“系统设置 → 隐私与安全性”，找到该应用的“仍要打开”，按系统提示确认。步骤见 [Apple：在 Mac 上安全地打开 App](https://support.apple.com/zh-cn/102445)。

若提示应用已损坏、会损坏电脑，或校验值不一致，请停止打开并重新核对下载，必要时通过 [GitHub Issues](https://github.com/NullResot/miweb/issues) 反馈。

## Linux

Linux 安装包尚未发布，开发者可以按 [开发与构建](/reference/developing) 从源码运行。

## 更新与卸载

更新版本从 [Releases](https://github.com/NullResot/miweb/releases) 下载并安装。当前不依赖后台自动更新服务。

Windows 可通过“设置 → 应用 → 已安装的应用”卸载 Miweb。macOS 更新时先退出 Miweb，再将新 DMG 中的应用拖入“应用程序”并确认替换；卸载时退出应用，将“应用程序”中的 Miweb 移到废纸篓。

安装、更新与卸载不会替你修改导入的项目源码；应用里的预览和临时调整不能代替代码备份。

## 接下来

按照 [第一次微调](/guide/getting-started) 熟悉操作，再 [连接自己的项目](/guide/import)。
