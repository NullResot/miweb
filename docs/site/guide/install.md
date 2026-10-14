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

## macOS 与 Linux

目前优先提供 Windows 安装包。macOS 与 Linux 没有已发布的桌面安装包，开发者可以按 [开发与构建](/reference/developing) 从源码运行。

## 更新与卸载

更新版本从 [Releases](https://github.com/NullResot/miweb/releases) 下载并安装。当前不依赖后台自动更新服务。

Windows 可通过“设置 → 应用 → 已安装的应用”卸载 Miweb。安装、更新与卸载不会替你修改导入的项目源码；应用里的预览和临时调整不能代替代码备份。

## 接下来

按照 [第一次微调](/guide/getting-started) 熟悉操作，再 [连接自己的项目](/guide/import)。
