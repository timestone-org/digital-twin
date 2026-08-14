/**
 * @fileoverview footer —— 钉在底部的整宽容器。它自己只画外壳，版权、联系方式、
 * 状态灯都是独立子节点，由运行时按节点树注入默认插槽（DASHBOARD_DESIGN §5.4）。
 */
import { defineModule } from '../../registry'
import {
  CONTAINER_CONFIG_KEY,
  CONTAINER_PAD_DEFAULT_PX,
  SHOW_TITLE_CONFIG_KEY,
} from '../../shared/container'

export default defineModule({
  type: 'footer',
  displayName: '页脚',
  category: '布局',
  icon: 'panel-bottom',
  keywords: ['footer', 'yejiao', '页脚', '底部', '页尾'],
  chrome: 'bare',
  isContainer: true,
  region: 'footer',
  defaultSize: { width: 1920, height: 72, minWidth: 240, minHeight: 40 },
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '标题',
      default: '',
      span: 'full',
      placeholder: '留空则标题条上没有文字',
      // 标题文本只在标题条里渲染，条关着时填了不会上屏 → 面板同步隐藏，免得「填了没反应」
      when: { key: SHOW_TITLE_CONFIG_KEY, in: [true] },
    },
    {
      key: SHOW_TITLE_CONFIG_KEY,
      label: '显示标题条',
      type: 'boolean',
      group: '标题',
      // ⚠ 这个 false 必须显式写着：缺省回落成「有标题条」会给页脚留 28px 的条，
      //   把全部子节点整体往下顶，而配置里根本没有这一项
      default: false,
      span: 'half',
    },
    {
      key: 'accent',
      label: '强调色',
      type: 'color',
      group: '外观',
      default: 'var(--accent-primary)',
      span: 'half',
      help: '顶部分隔线与扫光取这个色。',
    },
    {
      key: 'background',
      label: '背景',
      type: 'color',
      group: '外观',
      default: '',
      span: 'half',
      placeholder: '留空 = 透明，继承大屏背景',
    },
    {
      key: CONTAINER_CONFIG_KEY,
      label: '内部布局',
      type: 'object',
      group: '布局',
      // ⚠ 整块缺省写在这里，不从子字段拼：两个形状一定会漂（shared/config.ts）
      default: { pad: CONTAINER_PAD_DEFAULT_PX },
      help: '子节点摆在内容区里，内边距决定内容区比页脚矩形小多少。',
      fields: [
        {
          key: 'pad',
          label: '内边距 (px)',
          type: 'number',
          default: CONTAINER_PAD_DEFAULT_PX,
          min: 0,
          max: 64,
          step: 1,
        },
      ],
    },
  ],
  // 页脚自己不取数：版权、状态灯、按钮都是子节点，各自绑各自的
  bindings: [],
  preview: { config: { title: '运行状态', showTitle: true } },
  component: () => import('./Component.vue'),
})
