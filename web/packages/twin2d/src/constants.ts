/**
 * @fileoverview twin-2d-view 的配置键、文档版本、三个绑定槽键与行 fieldKey 构造，
 * 外加归一化共用的上限与缺省。模块清单、编辑器派生绑定行、运行时缝合读值共用这一批
 * 字面量；口径见 docs/MODULE_TWIN_2D_DESIGN.md §4.1、§14.1。
 */
import type { BindingSpec } from '@dt/contracts'

/** 节点 `configJson` 里 2D 孪生配置所在的键。 */
export const TWIN_2D_CONFIG_KEY = 'twin2d'

/**
 * 文档格式版本。
 * ⚠ 只认这个显式整数，不许靠「坐标是不是整数」这类结构启发式判断。
 */
export const TWIN_2D_CONFIG_VERSION = 1

/** 节点读数的数组绑定槽键：一行是一个节点的一个槽位。 */
export const TWIN_2D_NODE_BINDING_KEY = 'nodeValues'
/** 节点状态的数组绑定槽键：一行钉一个节点。 */
export const TWIN_2D_STATUS_BINDING_KEY = 'nodeStatus'
/** 连线读数的数组绑定槽键：一行钉一条连线。 */
export const TWIN_2D_EDGE_BINDING_KEY = 'edgeValues'

/** 节点读数行的子槽。 */
export const TWIN_2D_NODE_ROW_SLOTS = ['value'] as const
export type Twin2dNodeRowSlot = (typeof TWIN_2D_NODE_ROW_SLOTS)[number]

/** 节点状态行的子槽。 */
export const TWIN_2D_STATUS_ROW_SLOTS = ['status'] as const
export type Twin2dStatusRowSlot = (typeof TWIN_2D_STATUS_ROW_SLOTS)[number]

/** 连线读数行的三个子槽。 */
export const TWIN_2D_EDGE_ROW_SLOTS = ['active', 'direction', 'value'] as const
export type Twin2dEdgeRowSlot = (typeof TWIN_2D_EDGE_ROW_SLOTS)[number]

/** 任意数组行子槽，缝合读值按它取。 */
export type Twin2dRowSlot =
  Twin2dNodeRowSlot | Twin2dStatusRowSlot | Twin2dEdgeRowSlot

/**
 * 数组绑定第 index 行、第 sub 个子槽的 fieldKey。
 * ⚠ index 是 `normalizeTwin2dConfig` **输出**里的文档序：派生绑定行与缝合读值必须喂
 * 同一份归一化结果，喂原始配置会因为脏条目被丢弃而让其后每一行整体错位一格。
 * @param slotKey 数组槽键
 * @param index 归一化后的文档序下标
 * @param sub 行内子槽
 */
export function arrayRowFieldKey(
  slotKey: string,
  index: number,
  sub: Twin2dRowSlot,
): string {
  return `${slotKey}[${index}].${sub}`
}

/**
 * 扁平化后第 index 个「节点 × 槽位」读数的 fieldKey。
 * ⚠ 行号是**有效槽位**扁平后的序号，不是节点下标：删掉一个引用槽位的 `txt` 图元
 * 会让它之后每一行都改喂别的槽位，所以写配置必须无条件重派绑定（§14.3）。
 * @param index 扁平后的行号
 */
export function nodeRowFieldKey(index: number): string {
  return arrayRowFieldKey(TWIN_2D_NODE_BINDING_KEY, index, 'value')
}

/**
 * 第 index 个节点状态的 fieldKey。
 * @param index 节点文档序下标
 */
export function statusRowFieldKey(index: number): string {
  return arrayRowFieldKey(TWIN_2D_STATUS_BINDING_KEY, index, 'status')
}

/**
 * 第 index 条连线某个子槽的 fieldKey。
 * @param index 连线文档序下标
 * @param sub 行内子槽
 */
export function edgeRowFieldKey(index: number, sub: Twin2dEdgeRowSlot): string {
  return arrayRowFieldKey(TWIN_2D_EDGE_BINDING_KEY, index, sub)
}

/**
 * twin-2d-view 模块声明的绑定槽。
 * ⚠ 模块 manifest 直接摊开它，不许再抄一份键名：槽键在清单与缝合两处各写一遍时，
 * 拼错的那一份既不报错也永远取不到值。
 * ⚠ 三个槽都 `isEntityPinned`：一张图上四十个槽位只接三个点位是常态，索引留空只表示
 * 「这个实体没接数据源」。
 */
export const TWIN_2D_VIEW_BINDINGS: readonly BindingSpec[] = [
  {
    key: TWIN_2D_NODE_BINDING_KEY,
    label: '节点读数',
    dataType: 'number',
    isArray: true,
    isEntityPinned: true,
    arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
  },
  {
    key: TWIN_2D_STATUS_BINDING_KEY,
    label: '节点状态',
    // ⚠ 是 `number` 而不是 `enum`：状态在这里是**数字编码**（0 离线 / 1 在线 /
    //   2 警告 / 3 报警），由 `toDeviceStatus` 分档。`enum` 那一档的意思是
    //   「配了 enumMap，值要换成映射里的文案」——而求值层的 applyEnumMap 一旦
    //   把 1 换成语义词表里的串，toDeviceStatus 就认不出来，全图状态集体退回
    //   unknown（灰），且没有任何一处报错（§10.2）。声明成 enum 却不给 map，
    //   等于摆着一个「看起来该配映射」的槽等人踩，还让静态常量那一格从数字框
    //   退化成文本框。
    dataType: 'number',
    isArray: true,
    isEntityPinned: true,
    arrayFields: [{ key: 'status', label: '状态', dataType: 'number' }],
  },
  {
    key: TWIN_2D_EDGE_BINDING_KEY,
    label: '连线读数',
    dataType: 'number',
    isArray: true,
    isEntityPinned: true,
    arrayFields: [
      { key: 'active', label: '有流 / 通电', dataType: 'boolean' },
      { key: 'direction', label: '流向（负数 = 反向）', dataType: 'number' },
      { key: 'value', label: '标签读数', dataType: 'number' },
    ],
  },
]

/**
 * 图元树深度上限。
 * ⚠ 与模板嵌套 ≤6 层的闸门无关（渲染是递归组件，模板只有 3 层），这条纯粹是防
 * 「用户造出一棵一千层的树把浏览器摁死」。超深截断并进诊断（§4.2）。
 */
export const TWIN_2D_MAX_PRIM_DEPTH = 6

/** 派生槽算式的递归深度上限；超深截断并进诊断（§9.5）。 */
export const TWIN_2D_MAX_EXPR_DEPTH = 3

/** 画布边长下限（设计坐标）。 */
export const TWIN_2D_MIN_CANVAS_SIZE = 200
/** 画布边长上限，防一次误输入把整个舞台缩成看不见的一点。 */
export const TWIN_2D_MAX_CANVAS_SIZE = 20000
/** 新建画布的宽。 */
export const TWIN_2D_DEFAULT_CANVAS_WIDTH = 1280
/** 新建画布的高。 */
export const TWIN_2D_DEFAULT_CANVAS_HEIGHT = 720

/** 网格步长下限。 */
export const TWIN_2D_MIN_GRID = 2
/** 网格步长上限。 */
export const TWIN_2D_MAX_GRID = 200
/** 新建画布的网格步长。 */
export const TWIN_2D_DEFAULT_GRID = 20

/** 底纹间距缺省（§7.10 #76 的斜织间距）。 */
export const TWIN_2D_DEFAULT_PATTERN_GAP = 26
/** 底纹线宽缺省。 */
export const TWIN_2D_DEFAULT_PATTERN_WIDTH = 1

/**
 * 节点 `tags` 的键与值的长度上限。
 * ⚠ 只做 trim 与截断，不做白名单：做了白名单就等于把子类重新钉死成枚举（§6.3）。
 */
export const TWIN_2D_MAX_TAG_LENGTH = 64

/** 槽位占位符缺省（em dash）。 */
export const TWIN_2D_DEFAULT_PLACEHOLDER = '—'

/** 圆角折线的拐角半径缺省。 */
export const TWIN_2D_DEFAULT_CORNER_RADIUS = 8

/** 舞台四周留白（%）的下限。 */
export const TWIN_2D_MIN_FIT_PADDING = 0
/** 舞台四周留白（%）的上限。 */
export const TWIN_2D_MAX_FIT_PADDING = 20
/** 舞台四周留白（%）的缺省。 */
export const TWIN_2D_DEFAULT_FIT_PADDING = 4

/** 流动速度倍率下限。 */
export const TWIN_2D_MIN_FLOW_SPEED = 0.5
/** 流动速度倍率上限。 */
export const TWIN_2D_MAX_FLOW_SPEED = 5
/** 流动速度倍率缺省。 */
export const TWIN_2D_DEFAULT_FLOW_SPEED = 1
