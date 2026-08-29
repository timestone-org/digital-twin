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
  description:
    '通用容器：自己只画一条可关的标题条与一块内容区，里面的东西是独立子节点，由运行时按节点树注入——它不渲染任何内容，也没有绑定槽、不取数。要把几个模块框成一组、给它们共同的标题与背景时用它；钉在屏幕上下沿的整宽横条请用 header / footer，那两个各自钉死一条边且每屏只许一个。子节点的坐标以内容区左上角为原点，内容区 = 容器矩形减去 `__container.pad` 内边距，标题条开着时再减去顶部 28px。⚠ 关掉「显示标题条」会让这个容器里已有的全部子节点整体上移 28px：那一项不是纯外观开关，它改的是内容区原点。',
  displayName: '容器',
  category: '布局',
  icon: 'layout-template',
  keywords: ['container', 'rongqi', '容器', '分组', '面板'],
  chrome: 'bare',
  isContainer: true,
  // 标题条自绘（Component.vue）：竖条宽/高/辉光与标题字号字重字距字色走
  // --card-title-* 变量是通的，其余标题键壳里没有对应消费点
  unsupportedChromeKeys: [
    'showTitle',
    'titleAlign',
    'titlePadding',
    'titleGap',
    'titleBarRadius',
    'titleBarColor',
    'titleBarColorAlt',
    'titlePulse',
    'titlePulseDuration',
    'titleRule',
    'titleRuleHeight',
    'titleRuleOpacity',
  ],
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
      // 与页头页脚同一格：素材库能挑，也接图片地址与 CSS 值
      key: 'backgroundImage',
      label: '背景底图',
      type: 'image',
      group: '外观',
      default: '',
      span: 'full',
      placeholder: '留空 = 无，只有背景色',
      help: '可从素材库挑一张，也可填图片地址（按 cover 居中盖满）或 CSS 值（渐变 / url() / var()，铺法用浏览器默认，可拿它铺底纹）。叠在背景色之上，留空不注入。',
    },
    {
      key: 'radius',
      label: '圆角 (px)',
      type: 'number',
      group: '外观',
      default: 4,
      min: 0,
      max: 32,
      step: 1,
      span: 'half',
    },
    {
      key: 'showBorder',
      label: '描边',
      type: 'boolean',
      group: '外观',
      // ⚠ 缺省是**关**：容器一直没有边框，回落成开会给存量大屏里每一个容器
      //   凭空描一圈线
      default: false,
      span: 'half',
      help: '描边颜色取卡片外观里的边框色。',
    },
    {
      key: 'borderWidth',
      label: '描边粗细 (px)',
      type: 'number',
      group: '外观',
      default: 1,
      min: 0,
      max: 8,
      step: 1,
      span: 'half',
      when: { key: 'showBorder', in: [true] },
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
      key: 'dotSize',
      label: '点径 (px)',
      type: 'number',
      group: '外观',
      default: 1,
      min: 1,
      max: 6,
      step: 1,
      span: 'half',
      when: { key: 'showDotGrid', in: [true] },
    },
    {
      key: 'dotGap',
      label: '点距 (px)',
      type: 'number',
      group: '外观',
      default: 16,
      min: 4,
      max: 64,
      step: 1,
      span: 'half',
      when: { key: 'showDotGrid', in: [true] },
    },
    {
      key: 'dotOpacity',
      label: '点阵浓度',
      type: 'number',
      group: '外观',
      default: 0.12,
      min: 0,
      max: 1,
      step: 0.01,
      span: 'half',
      when: { key: 'showDotGrid', in: [true] },
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
