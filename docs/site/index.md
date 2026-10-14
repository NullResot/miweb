---
title: Miweb
description: 轻量的网页布局微调工具。安装桌面版，导入页面或本地项目，直接调整，再带走代码。
---

# Miweb

Miweb（微调）是一款轻量的网页布局微调工具。AI 生成的页面已经差不多了，但按钮还想往上一点，卡片还想宽一点——这些细节，可以直接在页面上调整。

安装桌面版，打开网页或本地项目，选中元素，用鼠标拖动或方向键微调，再复制代码带回项目。编辑过程不需要 AI 模型或 API Key。

<a class="download-link" href="https://github.com/NullResot/miweb/releases/latest/download/Miweb-Setup-x64.exe">下载 Windows 桌面版</a>
[安装说明](/guide/install) · [第一次微调](/guide/getting-started)

![Miweb 工作台：选中按钮，调整位置与尺寸，定位对应源码](/editor-preview.png)

<p class="caption">实际工作台，使用项目内置示例。</p>

## 可以做什么

- **直接微调布局**：拖动位置和宽高，也可以输入精确的偏移、尺寸、字号和圆角。
- **连接本地源码**：支持普通 HTML、Vite React 和 Vue 项目，导出修改后的源文件与最小 diff。
- **打开网页链接**：支持公网网址、localhost 和可访问的局域网地址，导出 CSS 或 JavaScript 布局补丁。
- **检查与回退**：撤销、重做、恢复元素，以及桌面、平板和手机宽度下的效果对比。

Miweb 适合完成前端页面的收尾调整，不会替你重建页面结构，也不会自动覆盖项目文件。

## 选择适合你的导入方式

| 你手上的内容 | 从哪里开始 | 可以带走什么 |
| --- | --- | --- |
| HTML、Vite React 或 Vue 项目源码 | [选择项目文件夹](/guide/import#本地项目) | 局部修改后的源码、最小 diff、布局补丁 |
| 已经运行的开发服务，例如 `http://localhost:5173` | [输入本地链接](/guide/import#本地开发链接) | 布局补丁 |
| 一个公开网页的网址 | [输入网页链接](/guide/import#网页链接) | 布局补丁 |
| 暂时没有页面，想看看怎么用 | [试用内置示例](/guide/getting-started) | 示例源码的修改与 diff |

**有支持的源码，才能导出与原文件对齐的源码修改。** 只提供网址时，Miweb 不能从构建后的网页还原原始 React / Vue 工程。

## 一次微调的流程

1. 打开桌面版，选择项目文件夹，或粘贴一个网页链接。
2. 点击画布中的元素，拖动、使用方向键，或在属性面板输入数值。
3. 切换不同预览宽度，检查调整前后的效果。
4. 点击“复制代码”或“复制补丁”，也可以查看 diff 并下载结果。

操作细节见 [选择与调整](/guide/edit)，如何应用结果见 [导出与应用代码](/guide/export)。

## 使用范围

Miweb 编辑的是**当前地址的渲染快照**，原页面脚本与导航在画布中暂停。需要登录、反自动化、Canvas、Shadow DOM 或持续交互的页面，可能无法完整导入。

请编辑自己或获得授权的页面，并在关闭应用前复制或下载结果。原文件始终由你在项目中审查和应用。

[查看常见问题](/reference/faq) · [查看源码与构建方法](/reference/developing) · [反馈问题](https://github.com/NullResot/miweb/issues)
