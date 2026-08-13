/**
 * @fileoverview @dt/ui 的 Storybook 装配：story 从哪来、用哪套构建、开哪些插件。
 * story 一律收在 ../stories/ 下，不与组件源码同放（同 tests/ 的规矩）。
 */
import vue from '@vitejs/plugin-vue'
import { mergeConfig } from 'vite'
import type { StorybookConfig } from '@storybook/vue3-vite'

const config: StorybookConfig = {
  framework: { name: '@storybook/vue3-vite', options: {} },
  stories: ['../stories/**/*.stories.ts'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  // 私有部署交付，构建与开发都不往外发使用数据
  core: { disableTelemetry: true },

  /**
   * ⚠ Vue 的 SFC 插件必须在这里自己加：`@storybook/vue3-vite` 只往 vite 里塞
   * docgen 与模板编译用的 vue 别名，编译 `.vue` 靠的是项目自己的 vite 配置，
   * 而本包没有 vite.config——不加的话所有 story 都会在加载组件时炸。
   * @param base Storybook 生成的基础 vite 配置
   */
  viteFinal: (base) =>
    mergeConfig(base, {
      plugins: [vue()],
      css: { preprocessorOptions: { scss: { api: 'modern-compiler' } } },
    }),
}

export default config
