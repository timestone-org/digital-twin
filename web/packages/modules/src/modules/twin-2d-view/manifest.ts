/**
 * @fileoverview twin-2d-view —— 2D 孪生画面。七个顶层配置键 + 三个实体钉行的数组绑定槽，
 * 整张图的形状（节点、连线、标注、节点样式）落在 `configJson.twin2d` 那一段里。
 * 绑定槽直接摊开 `TWIN_2D_VIEW_BINDINGS`，不在这里抄一份槽键——槽键写两遍时，
 * 拼错的那一份既不报错也永远取不到值（twin2d/constants.ts）。
 */
import type { ConfigOption } from '@dt/contracts'
import {
  TWIN_2D_CONFIG_KEY,
  TWIN_2D_DEFAULT_FIT_PADDING,
  TWIN_2D_DEFAULT_FLOW_SPEED,
  TWIN_2D_FIT_MODES,
  TWIN_2D_MAX_FIT_PADDING,
  TWIN_2D_MAX_FLOW_SPEED,
  TWIN_2D_MIN_FIT_PADDING,
  TWIN_2D_MIN_FLOW_SPEED,
  TWIN_2D_VIEW_BINDINGS,
  normalizeTwin2dConfig,
  twin2dRowCounts,
  twin2dRowLabels,
} from '@dt/twin2d'
import type { Twin2dFitMode } from '@dt/twin2d'

import { defineModule } from '../../registry'

/** 缩放四档在属性面板上叫什么。 */
const FIT_MODE_LABELS: Record<Twin2dFitMode, string> = {
  contain: '完整显示',
  width: '按宽铺满',
  height: '按高铺满',
  stretch: '拉满（会变形）',
  none: '原尺寸（不缩放）',
}

/**
 * 缩放档的下拉项。
 * ⚠ 从 `TWIN_2D_FIT_MODES` 摊开而不是在这里再列一遍：面板上多出一档舞台认不出的值时，
 * 用户选得到、画布上却按 `contain` 画，两侧都不报错。
 */
const FIT_MODE_OPTIONS: ConfigOption[] = TWIN_2D_FIT_MODES.map((value) => ({
  value,
  label: FIT_MODE_LABELS[value],
}))

/** 留白档的步长（百分点）。 */
const FIT_PADDING_STEP = 1
/** 流动倍率的步长。 */
const FLOW_SPEED_STEP = 0.1

/**
 * 拖进画布时的演示图：一条「源 → 换热 → 末端」的三节点链路。
 * ⚠ 只画形状、不塞任何读数：演示值归 `preview.values`，把数写进图文档就是同一个值
 * 有两个真源（§14.4）。
 */
const PREVIEW_SCENE = {
  version: 1,
  canvas: { width: 1280, height: 720 },
  nodes: [
    { id: 'src', styleId: 'waste-heat-source', x: 90, y: 250, label: '余热源' },
    { id: 'hx', styleId: 'heat-exchanger', x: 560, y: 280, label: '换热站' },
    { id: 'term', styleId: 'bath-terminal', x: 980, y: 280, label: '洗浴终端' },
  ],
  edges: [
    {
      id: 'e1',
      styleId: 'waste-heat',
      from: { nodeId: 'src' },
      to: { nodeId: 'hx' },
    },
    {
      id: 'e2',
      styleId: 'water',
      from: { nodeId: 'hx' },
      to: { nodeId: 'term' },
    },
  ],
}

export default defineModule({
  type: 'twin-2d-view',
  description:
    '2D 数字孪生模块，用于构建流程图、系统图、管网和一次接线图；三维模型场景应选择 3D 孪生。图元文档由 2D 孪生编辑器维护，属性面板仅控制标题、五档缩放和流动效果。节点数值、节点状态及连线数据通过三个实体钉定的数组槽按文档顺序关联。节点点击发送带稳定节点 id 的 `select` 事件，连线动画总开关关闭时所有流动效果停止。',
  displayName: '2D 孪生',
  category: '孪生',
  icon: 'network',
  keywords: [
    '2d',
    'twin',
    'luansheng',
    '孪生',
    '流程',
    '系统图',
    '接线',
    '电路',
  ],
  // 套框（chrome 缺省即 card）：一张图配上统一卡片外观与标题条，40 个 chrome 键全吃。
  // ⚠ `unsupportedChromeKeys` 一个都不声明——本模块没有自绘外壳，全套外观都落得下去
  defaultSize: { width: 1280, height: 480, minWidth: 240, minHeight: 120 },
  contentKeys: ['title', TWIN_2D_CONFIG_KEY, 'showSprite'],
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '标题',
      // ⚠ 刻意不给 default：default 会 materialize 进每一次渲染，改它等于改存量
      //   大屏的渲染结果。缺省即空串 = 不显示标题条
      span: 'full',
      help: '留空则不显示标题条。',
    },
    {
      key: TWIN_2D_CONFIG_KEY,
      label: '2D 孪生画面',
      type: 'object',
      group: '画面',
      // ⚠ 刻意不给 fields：图元树、变体、定长数组这些形状两列通用表单表达不了。
      //   属性面板对「object 且无 fields」的字段渲染成只读摘要 + 子编辑器入口
      span: 'full',
      help: '节点、连线、标注与节点样式都由 2D 孪生编辑器写入。',
    },
    {
      key: 'fitMode',
      label: '缩放方式',
      type: 'enum',
      group: '画面',
      default: 'contain',
      span: 'half',
      options: FIT_MODE_OPTIONS,
      help: '「完整显示」保留安全边距；「拉满」可产生变形；「原尺寸」保持 1:1，超出模块的部分会被裁剪。',
    },
    {
      key: 'fitPadding',
      label: '四周留白 (%)',
      type: 'range',
      group: '画面',
      default: TWIN_2D_DEFAULT_FIT_PADDING,
      min: TWIN_2D_MIN_FIT_PADDING,
      max: TWIN_2D_MAX_FIT_PADDING,
      step: FIT_PADDING_STEP,
      span: 'half',
      // 其余三档的意思就是「把某一轴填满」，再乘一个安全留白就填不满了
      when: { key: 'fitMode', in: ['contain'] },
      help: '只在「完整显示」下有意义。',
    },
    {
      key: 'showSprite',
      label: '使用内置图标集',
      type: 'boolean',
      group: '画面',
      default: true,
      span: 'half',
      help: '关闭后不显示内置 sprite 图标；素材图标和自定义图元不受影响。',
    },
    {
      key: 'animateFlow',
      label: '连线流动动画',
      type: 'boolean',
      group: '运行态',
      // ⚠ 同样刻意不给 default：缺省即 false = 不动，存量大屏零回归
      span: 'full',
      help: '全局开关；关闭时忽略各连线样式中的流动配置。',
    },
    {
      key: 'flowSpeed',
      label: '流动速度',
      type: 'range',
      group: '运行态',
      default: TWIN_2D_DEFAULT_FLOW_SPEED,
      min: TWIN_2D_MIN_FLOW_SPEED,
      max: TWIN_2D_MAX_FLOW_SPEED,
      step: FLOW_SPEED_STEP,
      span: 'half',
      when: { key: 'animateFlow', in: [true] },
      help: '全局倍率：最终时长 = 样式里的基准时长 ÷ 这个值。',
    },
  ],
  bindings: [...TWIN_2D_VIEW_BINDINGS],
  // 一张图上几十个读数，坏掉一个不能让整块被「取数失败」盖住，四档由 Component.vue 自己画
  ownsStatusDisplay: true,
  // 点节点上抛 `{ event: 'select', value: 节点 id }`
  emitsInteractions: true,
  // ⚠ 显式声明，不靠缺省：缺省是 `['click']`，而本模块上抛的是 `'select'`——
  //   不声明的话编辑器「触发事件」下拉里只有 click，用户配出来的规则永远不触发，
  //   而两侧都不报错
  interactionEvents: ['select'],
  // ⚠ `hostClickable` 刻意不开：画布内部有拖拽手势（运行态的平移/触屏滑动），
  //   整块可点会让每次拖完松手都派发一次 click
  // 属性面板只读这份声明来决定出不出入口，故这里的路由名写错 = 入口点了没反应
  subEditor: {
    configKey: TWIN_2D_CONFIG_KEY,
    routeName: 'twin-2d-editor',
    label: '打开 2D 孪生编辑器',
    hint: '在 2D 孪生编辑器中维护节点、连线、标注与节点样式。',
  },
  bindingRowLabels: (config) =>
    twin2dRowLabels(normalizeTwin2dConfig(config[TWIN_2D_CONFIG_KEY])),
  // ⚠ 行不是用户随手加的：行号就是实体的文档序。不声明行数的话，绑点面板会摆出
  //   「新增一行」，而加出来的那一行没有对应实体、永远喂不到任何东西
  bindingRowCounts: (config) =>
    twin2dRowCounts(normalizeTwin2dConfig(config[TWIN_2D_CONFIG_KEY])),
  preview: { config: { [TWIN_2D_CONFIG_KEY]: PREVIEW_SCENE } },
  component: () => import('./Component.vue'),
})
