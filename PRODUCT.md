# Miweb 产品约定

<!-- impeccable:product-schema 1 -->

## Platform

desktop (Windows x64, macOS Apple Silicon / Intel) + static documentation website

## Users

使用 AI 生成网页，希望通过直接操作完成少量布局微调的人。来自用户已明确的产品目标。

## Product Purpose

打开网页或导入本地项目，选中元素，通过鼠标和方向键调整位置与尺寸，复制修改后的代码。

## Positioning

用户明确主打轻量、即开即用。对外网站为 GitHub Pages 静态产品首页和文档；产品以内置运行环境的桌面安装包交付；Windows 使用每用户一键安装，macOS 使用原生架构 DMG。优先减少接入、操作和带走改动的成本，不以完整建站平台的功能数量为目标。

## Capabilities and Constraints

- 支持网址快照、基础 HTML / Vite React / Vue 项目；保留现有导入、撤销、恢复、比较、复制和下载流程。
- 仅网址导入时交付 CSS/JavaScript 布局补丁；有受支持源码时交付局部修改及 diff。不宣称从任意网址还原原工程。
- 桌面版内置 Electron、Node 服务与 Chromium；只监听回环地址，使用每次启动生成的访问密钥。原生系统目录选择读取本机源码。
- 网站首页复用完整滚动操作演示；文档入口采用标准侧栏、正文和页内目录。桌面首页仅保留首屏入口且无外层滚动条，保留既有编辑和导出语义。

## Brand Commitments

- 名称：微调 / miweb；保留标志结构和现有功能名称。
- 用户最新明确参考 https://www.apple.com.cn/iphone-18-pro/ ：整体黑色调，下滑有动画。此前白色展厅方向已被这条指令替换；保留大幅产品视觉、克制蓝色操作强调与清晰字阶。
- 用户明确要求保留旧版以便回档：最初版本在 design-versions/2026-10-13-original，上一版白色科技风在 design-versions/2026-10-13-gallery-white。
- 本次使用 pbakaus/impeccable 与 leonxlnx/taste-skill，用户附件的明确视觉约定优先于技能通用审美建议。

## Evidence on Hand

真实运行的编辑器、原版截图和回归测试；首页演示使用标明的示意页面，不是用户已导入的数据。没有客户数量、付费数据或用户评价，不添加此类陈述。
