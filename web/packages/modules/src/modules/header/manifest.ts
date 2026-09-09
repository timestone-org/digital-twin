/**
 * @fileoverview header —— 钉在顶部的整宽容器：上沿钉死，拖下沿改高。
 * 它自己只画科技风外壳（背景层、花纹风格、CRT 扫描线、横向扫光、底部辉光分隔线、
 * 中央两侧装饰），**标题、时钟、logo 一律是独立子节点**，由运行时按节点树注入。
 * ⚠ 壳里没有标题条：大屏标题就是拖一个文字块进来，位置、字号、颜色都归那个节点，
 * 壳再给一份必然与它抢位置，也让「标题在哪配」有两个答案。
 */
import type { ConfigField } from '@dt/contracts'

import { defineModule } from '../../registry'
import {
  CONTAINER_CONFIG_KEY,
  CONTAINER_PAD_DEFAULT_PX,
} from '../../shared/container'
import { HEADER_DECOS, HEADER_VARIANTS } from './options'

/** 「素净」之外的六档：花纹层、扫描线、扫光在这些风格下才画得出来。 */
const DECORATED_VARIANTS = HEADER_VARIANTS.filter(
  (item) => item.value !== 'plain',
).map((item) => item.value)

/** 画底部辉光线的那几档。「翼台」的下沿归轮廓收口，不画线。 */
const GLOW_LINE_VARIANTS = DECORATED_VARIANTS.filter(
  (value) => value !== 'podium',
)

/** 有装饰条的那几档；「无」档下中缝没有意义。 */
const DECORATED_STYLES = HEADER_DECOS.filter(
  (item) => item.value !== 'none',
).map((item) => item.value)

/** 扫光的四个从属项，只在扫光开着时露出来。 */
const SCAN_FIELDS: ConfigField[] = [
  {
    key: 'scanWidth',
    label: '扫光宽度 (%)',
    type: 'number',
    group: '动效',
    default: 30,
    min: 1,
    max: 100,
    step: 1,
    span: 'half',
    help: '光带宽度占页头宽度的比例；偏离 30% 较多时，循环边界可能出现跳变。',
    when: { key: 'scan', in: [true] },
  },
  {
    key: 'scanDuration',
    label: '扫光周期 (s)',
    type: 'number',
    group: '动效',
    default: 4,
    min: 0.5,
    max: 60,
    step: 0.5,
    span: 'half',
    help: '光带完成一次横向运动的时长，循环播放。',
    when: { key: 'scan', in: [true] },
  },
  {
    // 默认给变量而不是字面色值，换主题时扫光跟着卡片描边色一起变
    key: 'scanColor',
    label: '扫光颜色',
    type: 'color',
    group: '动效',
    default: 'var(--card-border)',
    span: 'half',
    help: '光带中心色，两端自动淡出为透明。',
    when: { key: 'scan', in: [true] },
  },
  {
    key: 'scanAbove',
    label: '扫光置顶',
    type: 'boolean',
    group: '动效',
    default: true,
    span: 'half',
    help: '开启后光带位于花纹与扫描线上方；子节点始终位于光带上方。',
    when: { key: 'scan', in: [true] },
  },
]

export default defineModule({
  type: 'header',
  description:
    '固定在大屏顶部的单实例整宽容器，用于承载标题、时钟和品牌标识等子节点。页头负责背景、装饰纹理、扫描线、横向扫光及底部分隔线，不直接渲染标题或数据。子节点坐标相对内部内容区计算；选择「素净」风格时，装饰、扫描线和扫光全部停用。模块不含数据绑定。',
  displayName: '页头',
  category: '布局',
  icon: 'layout-grid',
  keywords: ['header', 'yetou', '页头', '顶部', '标题栏'],
  chrome: 'bare',
  isContainer: true,
  region: 'header',
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
  defaultSize: { width: 1920, height: 108, minWidth: 240, minHeight: 48 },
  // 出厂就落库的键。⚠ 四角辉光在整宽横条上观感突兀，出厂关掉；属性面板里能再开回来
  defaultConfig: { __cardStyle: { corners: false } },
  configPresets: [
    {
      id: 'podium',
      label: '翼台横幅',
      hint: '翼台轮廓、倒角横带与 4 秒横向扫光；下边缘不显示分隔线。',
      config: {
        variant: 'podium',
        bgImage: 'var(--fx-decor-topbg) center bottom / 100% 100% no-repeat',
        // 两侧不放装饰条：标题、地点与时钟都是子节点，装饰条会与它们抢位置
        deco: 'none',
        // CRT 扫描线走大屏级的全屏一层，页头这层再来一遍会明显更脏
        scanlines: false,
        scan: true,
        scanWidth: 30,
        scanDuration: 4,
        scanColor: 'var(--card-border)',
        scanAbove: true,
        // 卡片四边框会把翼台轮廓框回一个矩形
        __cardStyle: { borderStyle: 'none' },
      },
    },
  ],
  configSchema: [
    {
      key: 'variant',
      label: '风格',
      type: 'enum',
      group: '外观',
      default: 'default',
      span: 'full',
      help: '「素净」不渲染两侧装饰、CRT 扫描线或横向扫光，相关字段同步隐藏。',
      options: [...HEADER_VARIANTS],
    },
    {
      key: 'deco',
      label: '两侧装饰',
      type: 'enum',
      group: '外观',
      default: 'bars',
      span: 'half',
      help: '沿中线左右对称的一对装饰；选「无」即不添加。',
      // ⚠ 「素净」把花纹层整个关掉，装饰条在它下面根本不画（Component.vue 的
      //   `isDecorated`）。不声明这个条件的话，面板上摆着一个选了没反应的下拉
      when: { key: 'variant', in: DECORATED_VARIANTS },
      options: [...HEADER_DECOS],
    },
    {
      key: 'decoGap',
      label: '装饰中缝 (px)',
      type: 'number',
      group: '外观',
      default: 0,
      min: 0,
      max: 800,
      step: 10,
      span: 'half',
      help: '两侧装饰的中央间距；0 表示按宽度自适应，中央子节点较宽时可适当增大。',
      when: { key: 'deco', in: DECORATED_STYLES },
    },
    {
      key: 'accent',
      label: '强调色',
      type: 'color',
      group: '外观',
      default: 'var(--accent-primary)',
      span: 'half',
      help: '花纹、装饰条与底部分隔线共用此颜色。',
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
      // 底图单独一层：滤镜只染底图，不把子节点的文字一起偏色
      key: 'bgImage',
      label: '背景底图',
      type: 'image',
      group: '外观',
      default: '',
      span: 'full',
      placeholder: '留空时使用风格内置花纹',
      help: '支持素材、图片地址或 CSS background；图片地址按整宽贴底方式渲染。',
    },
    {
      key: 'bgFilter',
      label: '底图滤镜',
      type: 'string',
      group: '外观',
      default: '',
      span: 'full',
      placeholder: '留空时使用主题装饰滤镜',
      help: '仅作用于背景图层；留空时使用主题滤镜，也可填写合法的 CSS filter。',
    },
    {
      key: 'glowLineInset',
      label: '底线内缩 (%)',
      type: 'number',
      group: '外观',
      default: 0,
      min: 0,
      max: 49,
      step: 1,
      span: 'half',
      help: '设置底部辉光分隔线两侧的内缩比例。0 表示贯通整行，10 表示保留中间 80%。',
      when: { key: 'variant', in: GLOW_LINE_VARIANTS },
    },
    {
      key: 'glowLineGlow',
      label: '底线外发光',
      type: 'boolean',
      group: '外观',
      default: true,
      span: 'half',
      help: '关闭后仅显示 1px 渐变线，不显示外发光。',
      when: { key: 'variant', in: GLOW_LINE_VARIANTS },
    },
    {
      key: 'scanlines',
      label: 'CRT 扫描线',
      type: 'boolean',
      group: '动效',
      default: true,
      span: 'half',
      help: '页头表面的横向扫描线纹理。',
      // 「素净」风格把花纹层整个关掉，这个开关在它下面调了没有任何变化 → 面板同步隐藏
      when: { key: 'variant', in: DECORATED_VARIANTS },
    },
    {
      // 默认关闭：会动的光带是显式选项，不默认加在页头上
      key: 'scan',
      label: '横向扫光',
      type: 'boolean',
      group: '动效',
      default: false,
      span: 'half',
      help: '一条自左向右循环掠过页头的渐变光带。',
      when: { key: 'variant', in: DECORATED_VARIANTS },
    },
    ...SCAN_FIELDS,
    {
      key: CONTAINER_CONFIG_KEY,
      label: '内部布局',
      type: 'object',
      group: '布局',
      // ⚠ 整块缺省写在这里，不从子字段拼：两个形状一定会漂（shared/config.ts）
      default: { pad: CONTAINER_PAD_DEFAULT_PX },
      help: '内边距决定子节点内容区相对页头矩形的内缩量。',
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
  // 页头自己不取数：标题、时钟、读数都是子节点，各自绑各自的
  bindings: [],
  // 刻意不给 preview：页头自带花纹与底线，空着也看得见，编一份演示配置只会让画布与
  // 运行态长得不一样
  component: () => import('./Component.vue'),
})
