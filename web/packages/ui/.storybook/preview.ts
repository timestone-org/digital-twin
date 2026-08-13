/**
 * @fileoverview Storybook 画布的全局装配：设计 token、换肤工具栏与文档口径。
 * 组件的取值全部来自 @dt/tokens 的 CSS 变量，所以这里必须先把 tokens 引进来，
 * 否则每个组件都会渲染成「无色的裸 DOM」——不报错，只是全错。
 */
import { applyTheme, DEFAULT_THEME_ID, listThemes } from '@dt/tokens'
import { themes } from 'storybook/theming'
import type { Decorator, Preview } from '@storybook/vue3-vite'

import '@dt/tokens/tokens.scss'
import './preview.scss'

const THEME_ITEMS = listThemes().map((theme) => ({
  value: theme.id,
  title: `${theme.name}（${theme.mode === 'dark' ? '深色' : '浅色'}）`,
}))

/**
 * 从 globals 里取主题 id。globals 是无类型的字典，取值先窄化再用，
 * 不写 `as`。
 * @param globals 当前 story 的全局取值
 */
function themeIdOf(globals: Record<string, unknown>): string {
  const value = globals['theme']
  return typeof value === 'string' ? value : DEFAULT_THEME_ID
}

/**
 * 换肤：把选中的主题写成文档根上的内联变量，整块画布跟着变。
 * ⚠ story 本体由模板里的 `<story />` 渲染（渲染器已全局注册它），
 * 所以第一个参数用不上。
 */
const withTheme: Decorator = (_story, context) => {
  applyTheme(document.documentElement, themeIdOf(context.globals))
  return { template: '<div class="sb-canvas"><story /></div>' }
}

const preview: Preview = {
  decorators: [withTheme],
  // 每个组件都自动生成一页文档；prop 表由 vue-docgen 从 SFC 的注释里抽
  tags: ['autodocs'],
  initialGlobals: { theme: DEFAULT_THEME_ID },
  globalTypes: {
    theme: {
      description: '换肤：写文档根的内联 CSS 变量，覆盖 tokens.scss 的 :root',
      toolbar: {
        title: '主题',
        icon: 'paintbrush',
        items: THEME_ITEMS,
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    layout: 'padded',
    // 组件库本身是深色工业风，文档页跟着深色，免得亮白页面上看不清描边
    docs: { theme: themes.dark },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
      expanded: true,
    },
    options: {
      storySort: { order: ['通用', '表单', '数据展示', '反馈', '浮层', '*'] },
    },
  },
}

export default preview
