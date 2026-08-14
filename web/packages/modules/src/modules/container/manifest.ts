/**
 * @fileoverview container —— 通用容器。它自己只画标题条与内容区，子节点由运行时
 * 按节点树注入默认插槽，坐标以内容区左上角为原点（DASHBOARD_DESIGN §5.4）。
 */
import { defineModule } from '../../registry'
import {
  CONTAINER_CONFIG_KEY,
  CONTAINER_PAD_DEFAULT_PX,
  SHOW_TITLE_CONFIG_KEY,
} from '../../shared/container'

export default defineModule({
  type: 'container',
  displayName: '容器',
  category: '布局',
  icon: 'layout-template',
  keywords: ['container', 'rongqi', '容器', '分组', '面板'],
  chrome: 'bare',
  isContainer: true,
  defaultSize: { width: 640, height: 432, minWidth: 120, minHeight: 80 },
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
      // ⚠ 改这一项会挪动**存量**容器里全部子节点：标题条占 28px 内容区高度，
      //   而子节点坐标以内容区左上角为原点
      default: true,
      span: 'half',
    },
    {
      key: 'accent',
      label: '强调色',
      type: 'color',
      group: '外观',
      default: 'var(--accent-primary)',
      span: 'half',
      help: '标题竖条与内容区点阵取这个色。',
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
      key: 'backgroundImage',
      label: '背景图 / 渐变',
      type: 'string',
      group: '外观',
      default: '',
      span: 'full',
      placeholder: '留空 = 无；填 CSS：linear-gradient(…) 或 url(…)',
      help: '叠在背景色之上的 CSS background-image 值；留空不注入，纯色背景不受影响。',
    },
    {
      key: 'showDotGrid',
      label: '点阵底纹',
      type: 'boolean',
      group: '外观',
      default: true,
      span: 'half',
      help: '内容区铺一层点阵，示意子节点的可放置范围。',
    },
    {
      key: CONTAINER_CONFIG_KEY,
      label: '内部布局',
      type: 'object',
      group: '布局',
      // ⚠ 整块缺省写在这里，不从子字段拼：两个形状一定会漂（shared/config.ts）
      default: { pad: CONTAINER_PAD_DEFAULT_PX },
      help: '子节点摆在内容区里，内边距决定内容区比容器矩形小多少。',
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
  // 容器自己不取数：读数、图表、文字都是子节点，各自绑各自的
  bindings: [],
  preview: { config: { title: '分组' } },
  component: () => import('./Component.vue'),
})
