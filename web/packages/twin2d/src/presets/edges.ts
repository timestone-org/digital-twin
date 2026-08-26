/**
 * @fileoverview 5 种预置连线样式：余热 / 蒸汽 / 空气能 / 太阳能 / 水流。
 * 每一种都只是一份 `Twin2dEdgeStyle` 字面量，与用户自建的连线样式走**同一条**渲染
 * 路径——连线层里没有一处按 id 分支，多出来的只有数据。
 * 数值口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.9。
 */
import { TWIN_2D_DEFAULT_CORNER_RADIUS } from '../constants'
import { TWIN_2D_PALETTE, mixTransparent } from './palette'
import type {
  Twin2dEdgeLabel,
  Twin2dEdgeMarker,
  Twin2dEdgeStyle,
} from '../types'
import type { Twin2dStrokePass } from '../typesPrim'
import type { Twin2dPaletteKey } from './palette'

/**
 * 描边与箭头的取色。
 * ⚠ 不写调色板取值：边色由 `Twin2dEdgeLayer.vue` 注在组上的 `--t2-accent` 经
 * `.t2-edge { color: … }` 落成 `currentColor`，写死颜色就把「连线实例上改一处
 * `accent` 就换色」这条整个废掉，而表现只是「改了没反应」。
 */
const INHERITED = 'currentColor'
/** 芯线线宽（§7.9 #62） */
const CORE_WIDTH = 2
/** 芯线虚线：一个完整周期 10 + 10（§7.9 #62 #67） */
const CORE_DASH: readonly number[] = Object.freeze([10, 10])
/** 宽底线宽（§7.9 #69 的双线：宽底窄芯） */
const BASE_WIDTH = 6
/** 宽底保留的边色百分比 */
const BASE_MIX = 22
/** 流动基准时长，参考项目的 0.8s（§7.9 #67） */
const FLOW_DURATION_MS = 800
/** 箭头边长（§7.9 #65） */
const ARROW_SIZE = 10
/** 箭头张开半角，弧度（§7.9 #65） */
const ARROW_SPREAD = 0.42
/** 箭头透明度（§7.9 #65） */
const ARROW_OPACITY = 0.82
/** 非活跃边的整组透明度（§7.9 #68） */
const INACTIVE_OPACITY = 0.5
/** 标签字号 */
const LABEL_FONT_SIZE = 12
/** 标签字重 */
const LABEL_FONT_WEIGHT = 600
/** 标签底板留白，顺序 t / r / b / l */
const LABEL_PAD: readonly [number, number, number, number] = Object.freeze([
  2, 6, 2, 6,
])
/** 标签底板底色保留的底板色百分比：压住底下的导线又不糊成一块 */
const LABEL_FILL_MIX = 80

/**
 * 多遍描边，文档序即从下往上：宽底一遍 + 窄芯一遍。
 * ⚠ 流动只加在**最上面**那一遍（`edgeView.ts` 的 `strokeViewsOf`），所以芯线必须是
 * 数组的最后一项：两遍反过来写就成了「一条粗虚线在爬」。
 * ⚠ 芯线那一遍逐值同参考项目的 `.topo-edge`（2px / 10 10 / 圆头圆角 /
 * `vector-effect: non-scaling-stroke`）；宽底那一遍是参考项目没有的一遍。
 */
const EDGE_STROKES: readonly Twin2dStrokePass[] = Object.freeze([
  Object.freeze({
    id: 'base',
    width: BASE_WIDTH,
    color: mixTransparent(INHERITED, BASE_MIX),
    dash: Object.freeze([]),
    cap: 'round',
    join: 'round',
    opacity: 1,
    nonScaling: true,
  }),
  Object.freeze({
    id: 'core',
    width: CORE_WIDTH,
    color: INHERITED,
    dash: CORE_DASH,
    cap: 'round',
    join: 'round',
    opacity: 1,
    nonScaling: true,
  }),
])

/** 末端箭头：贴着终点、指向行进方向（§7.9 #65） */
const END_ARROW: Twin2dEdgeMarker = Object.freeze({
  kind: 'arrow',
  size: ARROW_SIZE,
  spread: ARROW_SPREAD,
  filled: true,
  opacity: ARROW_OPACITY,
})

/** 起点不画标记：一条线上两个箭头会把「谁流向谁」讲反 */
const START_NONE: Twin2dEdgeMarker = Object.freeze({ kind: 'none' })

/**
 * 连线标签的排版（§7.9 #70，参考项目没有这一件）。
 * ⚠ 字色与字距两键**刻意缺席**：缺席即跟随主题，而 `Twin2dEdgeLabelView` 会把
 * 缺席的字色落成 `currentColor` = 边色。显式写 `color` 反而钉死一格。
 */
const EDGE_LABEL: Twin2dEdgeLabel = Object.freeze({
  font: Object.freeze({
    family: 'var(--font-digit)',
    size: LABEL_FONT_SIZE,
    weight: LABEL_FONT_WEIGHT,
  }),
  box: Object.freeze({
    fill: mixTransparent('var(--surface-base)', LABEL_FILL_MIX),
    border: Object.freeze({
      width: 0,
      style: 'none',
      color: INHERITED,
      sides: Object.freeze({
        top: true,
        right: true,
        bottom: true,
        left: true,
      }),
    }),
    radius: 'pill',
    pad: LABEL_PAD,
  }),
})

/** 一种预置连线的身份：落库 id、中文名与主色的调色板键。 */
export interface Twin2dEdgePresetDef {
  id: string
  name: string
  paletteKey: Twin2dPaletteKey
}

/**
 * 5 种能流的身份表，id 与中文名逐字取自参考项目的 `BUILTIN_EDGE_KINDS`。
 * ⚠ 空气能这一档的连线 id 是 `air`，而节点侧的**子类**标签是 `air-energy`——
 * 参考项目两处本来就不同名，对齐成一个反而让存量取值落不进白名单。
 */
export const TWIN_2D_EDGE_PRESET_DEFS = [
  { id: 'waste-heat', name: '余热', paletteKey: 'wasteHeat' },
  { id: 'steam', name: '蒸汽', paletteKey: 'steam' },
  { id: 'air', name: '空气能', paletteKey: 'airEnergy' },
  { id: 'solar', name: '太阳能', paletteKey: 'solar' },
  { id: 'water', name: '水流', paletteKey: 'water' },
] as const satisfies readonly Twin2dEdgePresetDef[]

/** 预置连线的 id 联合。 */
export type Twin2dEdgePresetId = (typeof TWIN_2D_EDGE_PRESET_DEFS)[number]['id']

/**
 * 按一种能流构一份连线样式。
 * ⚠ `route` 给 `'auto'` 而不是就地钉 `'orthogonal'`：`'auto'` 会在连线层落到几何层
 * 的缺省（正交），钉死一档会让连线实例上的走线选择无从跟随样式（§7.9 #63）。
 * @param def 这一种的身份
 */
export function twin2dEdgePreset(def: Twin2dEdgePresetDef): Twin2dEdgeStyle {
  return {
    id: def.id,
    name: def.name,
    accent: TWIN_2D_PALETTE[def.paletteKey],
    strokes: EDGE_STROKES,
    route: 'auto',
    cornerRadius: TWIN_2D_DEFAULT_CORNER_RADIUS,
    startMarker: START_NONE,
    endMarker: END_ARROW,
    flow: { enabled: true, dash: CORE_DASH, durationMs: FLOW_DURATION_MS },
    // 空串 = 非活跃时沿用边色，只压透明度与拉直虚线（§7.9 #68）
    inactive: { opacity: INACTIVE_OPACITY, dashOff: true, color: '' },
    label: EDGE_LABEL,
  }
}

/**
 * 5 种预置连线样式，文档序即调色板里的摆放序。
 * ⚠ 同 id 以文档里的 `edgeStyles[]` 为准（§13.4）：这一批只是落不到文档时的兜底，
 * 不是「改不动的内置项」。
 */
export const TWIN_2D_EDGE_PRESETS: readonly Twin2dEdgeStyle[] =
  TWIN_2D_EDGE_PRESET_DEFS.map(twin2dEdgePreset)
