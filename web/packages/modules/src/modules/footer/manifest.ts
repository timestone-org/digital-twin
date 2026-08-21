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
  // 标题条自绘（Component.vue）：没有竖条也没有装饰带，只有标题色/字号/字距
  // 走 --card-title-* 变量；其余标题键壳里没有对应消费点
  unsupportedChromeKeys: [
    'showTitle',
    'titleAlign',
    'titlePadding',
    'titleGap',
    'titleFontWeight',
    'titleBarWidth',
    'titleBarFull',
    'titleBarRadius',
    'titleBarGlow',
    'titleBarColor',
    'titleBarColorAlt',
    'titlePulse',
    'titlePulseDuration',
    'titleRule',
    'titleRuleHeight',
    'titleRuleOpacity',
  ],
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
      key: 'titleAlign',
      label: '标题对齐',
      type: 'enum',
      group: '标题',
      default: 'center',
      span: 'half',
      options: [
        { value: 'left', label: '靠左' },
        { value: 'center', label: '居中' },
        { value: 'right', label: '靠右' },
      ],
      when: { key: SHOW_TITLE_CONFIG_KEY, in: [true] },
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
      key: 'showDivider',
      label: '顶部分隔线',
      type: 'boolean',
      group: '外观',
      default: true,
      span: 'half',
    },
    {
      key: 'dividerWidth',
      label: '分隔线粗细 (px)',
      type: 'number',
      group: '外观',
      default: 1,
      min: 0,
      max: 8,
      step: 1,
      span: 'half',
      when: { key: 'showDivider', in: [true] },
    },
    {
      key: 'showSweep',
      label: '顶边扫光',
      type: 'boolean',
      group: '外观',
      default: true,
      span: 'half',
      help: '顶边一条由强调色渐隐的高光带，纯装饰。',
    },
    {
      key: 'sweepOpacity',
      label: '扫光浓度',
      type: 'number',
      group: '外观',
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
      span: 'half',
      when: { key: 'showSweep', in: [true] },
    },
    {
      key: 'showDotGrid',
      label: '点阵底纹',
      type: 'boolean',
      group: '外观',
      // ⚠ 与容器相反，这里缺省是**关**：页脚一直没有点阵，回落成开会给存量大屏
      //   的每一条页脚凭空铺一层底纹
      default: false,
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
  // ⚠ 不给演示配置：预览只铺没配过的键，凡是与 configSchema 缺省不一致的一项，
  //   都会让刚拖进画布的页脚与保存后的运行态长得不一样（标题条那 28px 尤其明显）
  component: () => import('./Component.vue'),
})
