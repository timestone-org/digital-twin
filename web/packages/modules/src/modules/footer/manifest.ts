/**
 * @fileoverview footer —— 钉在底部的整宽容器：下沿钉死，拖上沿改高。
 * 它自己只画外壳，版权、联系方式、状态灯都是独立子节点，由运行时注入默认插槽。
 * ⚠ 与页头对称，壳里**没有标题条**：要一行字就拖一个文字块进来。
 */
import { defineModule } from '../../registry'
import {
  CONTAINER_CONFIG_KEY,
  CONTAINER_PAD_DEFAULT_PX,
} from '../../shared/container'

export default defineModule({
  type: 'footer',
  description:
    '固定在大屏底部的单实例整宽容器，用于承载版权、联系方式或状态节点。页脚仅渲染背景、顶部分隔线、扫光和可选点阵，具体内容由独立子节点提供。模块不含数据绑定，子节点坐标相对内部内容区计算。分隔线宽度或扫光浓度设为 0 时，对应效果关闭。',
  displayName: '页脚',
  category: '布局',
  icon: 'panel-bottom',
  keywords: ['footer', 'yejiao', '页脚', '底部', '页尾'],
  chrome: 'bare',
  isContainer: true,
  region: 'footer',
  contentKeys: [CONTAINER_CONFIG_KEY],
  // 壳里没有标题条，整套标题键都没有消费点。少登记一个 = 面板上多一个
  // 「配了没反应」的控件
  unsupportedChromeKeys: [
    'showTitle',
    'titleColor',
    'titleAlign',
    'titlePadding',
    'titleGap',
    'titleFontSize',
    'titleFontWeight',
    'titleLetterSpacing',
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
      key: 'accent',
      label: '强调色',
      type: 'color',
      group: '外观',
      default: 'var(--accent-primary)',
      span: 'half',
      help: '顶部分隔线、顶边扫光与点阵底纹共用此颜色。',
    },
    {
      key: 'background',
      label: '背景',
      type: 'color',
      group: '外观',
      default: '',
      span: 'half',
      placeholder: '留空时透明并继承大屏背景',
    },
    {
      // 与页头同一格：素材库能挑，也接地址与 CSS 简写
      key: 'backgroundImage',
      label: '背景底图',
      type: 'image',
      group: '外观',
      default: '',
      span: 'full',
      placeholder: '留空时仅显示背景色',
      help: '支持素材、图片地址或 CSS background；图片地址按整宽贴底方式渲染。',
    },
    {
      // ⚠ 不另设「显示分隔线」开关：两个旋钮描述同一条边必然会漂，0 就是不画
      key: 'dividerWidth',
      label: '顶部分隔线 (px)',
      type: 'number',
      group: '外观',
      default: 1,
      min: 0,
      max: 8,
      step: 1,
      span: 'half',
      help: '0 表示不显示分隔线。',
    },
    {
      // 同上：浓度 0 就是没有扫光，不再多一个开关
      key: 'sweepOpacity',
      label: '顶边扫光浓度',
      type: 'number',
      group: '外观',
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
      span: 'half',
      help: '顶边强调色渐隐高光的透明度；0 表示关闭。',
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
      help: '在内容区显示点阵底纹，用于辅助识别子节点可用区域。',
    },
    {
      key: CONTAINER_CONFIG_KEY,
      label: '内部布局',
      type: 'object',
      group: '布局',
      // ⚠ 整块缺省写在这里，不从子字段拼：两个形状一定会漂（shared/config.ts）
      default: { pad: CONTAINER_PAD_DEFAULT_PX },
      help: '内边距决定子节点内容区相对页脚矩形的内缩量。',
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
  //   都会让刚拖进画布的页脚与保存后的运行态长得不一样
  component: () => import('./Component.vue'),
})
