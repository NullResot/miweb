import { defineConfig } from 'vitepress'

const base = process.env.MIWEB_DOCS_BASE || '/miweb/'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Miweb 微调',
  description: 'Miweb 桌面版文档。导入网页或本地项目，直接调整布局，带走局部源码修改或布局补丁。',
  base,
  cleanUrls: false,
  appearance: 'dark',
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#101012' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Miweb 微调',
    nav: [
      { text: '文档', link: '/' },
      { text: '下载桌面版', link: '/guide/install' },
      { text: '更新记录', link: 'https://github.com/NullResot/miweb/releases' },
    ],
    sidebar: [
      {
        text: '开始使用',
        items: [
          { text: 'Miweb 是什么', link: '/' },
          { text: '安装桌面版', link: '/guide/install' },
          { text: '第一次微调', link: '/guide/getting-started' },
        ],
      },
      {
        text: '使用指南',
        items: [
          { text: '导入页面与项目', link: '/guide/import' },
          { text: '选择与调整', link: '/guide/edit' },
          { text: '导出与应用代码', link: '/guide/export' },
        ],
      },
      {
        text: '参考',
        items: [
          { text: '快捷键', link: '/reference/shortcuts' },
          { text: '常见问题', link: '/reference/faq' },
          { text: '开发与构建', link: '/reference/developing' },
        ],
      },
    ],
    outline: { label: '本页内容', level: [2, 3] },
    socialLinks: [{ icon: 'github', link: 'https://github.com/NullResot/miweb' }],
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                displayDetails: '显示详细结果',
                resetButtonTitle: '清除搜索',
                backButtonTitle: '返回',
                noResultsText: '没有找到相关文档',
                footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
    editLink: {
      pattern: 'https://github.com/NullResot/miweb/edit/main/docs/site/:path',
      text: '在 GitHub 上编辑此页',
    },
    lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium' } },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换为浅色主题',
    darkModeSwitchTitle: '切换为深色主题',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '返回顶部',
  },
})
