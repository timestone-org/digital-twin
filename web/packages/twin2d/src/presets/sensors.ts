/**
 * @fileoverview 4 种预置传感器药丸：TT 温度 / FT 流量 / PT 压力 / LT 液位。
 * 一枚药丸**不是一等图元**，是一个 `box`（药丸底 + 主色描边 + 外发光）套三个 `txt`
 * （缩写 / 读数 / 单位）——这正是「内置库只是预置数据」的直接证明：为了它，四种图元
 * kind 之外一个新 kind 都没有加，而任何节点样式把 `twin2dSensorPill()` 的产物塞进
 * `prims` 或节点实例的 `layers` 就得到同一枚药丸。
 * 数值口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.8。
 */
import { TWIN_2D_PALETTE, mixTransparent } from './palette'
import type { Twin2dSlot } from '../types'
import type {
  Twin2dBoxPrim,
  Twin2dPlacement,
  Twin2dPrimBase,
  Twin2dTxtPrim,
} from '../typesPrim'
import type { Twin2dPaletteKey } from './palette'

/**
 * 药丸的基准字号（参考项目的 `.topo-sensor` 是 16px）。
 * ⚠ 参考项目里除它以外的尺寸全是相对它的 `em`，而本模型的 `layout.gap` /
 * `layout.pad` / `font.size` / `font.letterSpacing` 一律是**设计像素**，所以下面
 * 那几个数是按 16px 折算出来的定值：改基准字号时它们不会跟着变。
 */
const PILL_FONT_SIZE = 16
/** 三片之间的间隙：0.28em */
const PILL_GAP = 4.48
/** 上下内边距：0.12em */
const PILL_PAD_Y = 1.92
/** 左右内边距：0.5em */
const PILL_PAD_X = 8
/** 缩写的字距：0.04em */
const TAG_LETTER_SPACING = 0.64
/** 单位字号：0.78em */
const UNIT_FONT_SIZE = 12.48
/** 单位的透明度 */
const UNIT_OPACITY = 0.82
/** 缩写与读数的字重 */
const BOLD_WEIGHT = 700
/** 药丸外发光的模糊半径：0 0 6px */
const GLOW_BLUR = 6
/** 外发光保留的主色百分比 */
const GLOW_MIX = 55
/** 读数字晕的模糊半径：0 0 5px */
const READING_GLOW_BLUR = 5
/** 描边宽度 */
const PILL_BORDER_WIDTH = 1
/**
 * 药丸底色。
 * ⚠ 参考项目写的是 `var(--topo-node-fill-a, var(--surface-panel))`，而那个变量
 * **全仓无定义、只活在兜底位**，所以实际生效的一直是兜底那一段。本仓的对应量是
 * 节点根上注入的 `--t2-fill-a`，兜底段照抄——药丸脱离节点单用时靠它取色（§11.1）。
 */
const PILL_FILL = 'var(--t2-fill-a, var(--surface-panel))'
/** 取自身文字色 */
const INHERITED = 'currentColor'
/** 缩写用的展示字族 */
const TAG_FAMILY = 'var(--font-display)'
/** 读数用的等宽数字字族（`paintText.ts` 按它挂 `.t2-digit`） */
const DIGIT_FAMILY = 'var(--font-digit)'
/**
 * 变换基点。
 * ⚠ 与 `normalizePrims.ts` 的缺省逐字相同：不同的话预置数据过一遍归一化就不再恒等，
 * 而这一处不等只表现为「拖进画布的药丸与调色板里那枚缩放中心差一点」。
 */
const CENTER_ORIGIN = '50% 50%'
/** 三片都排在药丸这一行里 */
const FLOW_AT: Twin2dPlacement = Object.freeze({ kind: 'flow' })

/**
 * 传感器读数的占位符。
 * ⚠ 传感器侧是**两个 ASCII 连字符**，节点侧是 em dash `'—'`（`TWIN_2D_DEFAULT_PLACEHOLDER`）。
 * 看着像不一致，参考项目两处各有测试锁定，本仓保留这处差异：它是槽位上的**数据**，
 * 想统一的用户自己改一格就行（§7.12 #90）。
 */
export const TWIN_2D_SENSOR_PLACEHOLDER = '--'

/** 一种预置传感器的身份：缩写、中文名、主色、单位与读数取的槽位键。 */
export interface Twin2dSensorDef {
  /** 落库 id，同时是药丸上显示的缩写。 */
  id: string
  label: string
  paletteKey: Twin2dPaletteKey
  unit: string
  slotKey: string
}

/**
 * 4 种传感器的身份表，逐字取自参考项目的 `BUILTIN_SENSOR_KINDS`。
 * ⚠ 主色是**系列色板的复用**，不是温度语义色：TT 走系列 1（绿）而不是
 * `tempHot`/`tempCold`，PT 与太阳能同色、FT 与空气能同色、LT 与水流同色。
 * 照「温度当然是红的」改一格就与参考项目不再同色，而没有一处会报错。
 */
export const TWIN_2D_SENSOR_DEFS = [
  {
    id: 'TT',
    label: '温度',
    paletteKey: 'wasteHeat',
    unit: '℃',
    slotKey: 'temperature_c',
  },
  {
    id: 'FT',
    label: '流量',
    paletteKey: 'airEnergy',
    unit: 'm³/h',
    slotKey: 'flow_m3h',
  },
  {
    id: 'PT',
    label: '压力',
    paletteKey: 'solar',
    unit: 'kPa',
    slotKey: 'pressure_kpa',
  },
  {
    id: 'LT',
    label: '液位',
    paletteKey: 'water',
    unit: '%',
    slotKey: 'level_pct',
  },
] as const satisfies readonly Twin2dSensorDef[]

/** 预置传感器的 id 联合。 */
export type Twin2dSensorId = (typeof TWIN_2D_SENSOR_DEFS)[number]['id']

/**
 * 药丸的缺省落点：贴在节点盒上边中点的外侧。
 * ⚠ 九档锚点与 `perim` 是两套位移数学，换落点时换的是这一整个对象而不是里面的
 * `dx/dy`（§4.3）。
 */
export const TWIN_2D_SENSOR_DEFAULT_AT: Twin2dPlacement = Object.freeze({
  kind: 'anchor',
  anchor: 't',
  dx: 0,
  dy: 0,
})

/**
 * 图元基类的十六项。
 * ⚠ 除摆位与 `pointerEvents` 之外全部走 `normalizePrims` 的缺省，取值逐项对齐。
 * ⚠ 四片**都**是 `pointerEvents: 'none'`：只关外层不够——CSS 里子元素上的
 * `pointer-events: auto` 会把命中判定重新打开，于是药丸把它贴着的那个节点的
 * hover 抢掉一块（§7.8 #60）。
 */
function baseOf(id: string, at: Twin2dPlacement): Twin2dPrimBase {
  return {
    id,
    at,
    size: { w: 'auto', h: 'auto' },
    minWidth: null,
    maxWidth: null,
    z: 0,
    opacity: 1,
    hidden: false,
    when: null,
    anim: null,
    transition: null,
    rotate: 0,
    scale: 1,
    transformOrigin: CENTER_ORIGIN,
    pointerEvents: 'none',
    keepUpright: false,
  }
}

// 缩写：`TT` 这一片。参考项目用的是 DIN Alternate，本仓没有这个字族，改用展示字族
function tagTxt(
  def: Twin2dSensorDef,
  idPrefix: string,
  color: string,
): Twin2dTxtPrim {
  return {
    ...baseOf(`${idPrefix}-kind`, FLOW_AT),
    kind: 'txt',
    src: { kind: 'lit', text: def.id },
    lineHeight: null,
    font: {
      family: TAG_FAMILY,
      size: PILL_FONT_SIZE,
      weight: BOLD_WEIGHT,
      letterSpacing: TAG_LETTER_SPACING,
      color,
    },
    align: 'start',
    baseline: 'auto',
    nowrap: true,
    ellipsis: false,
    titleAttr: false,
    shadows: [],
    outline: null,
  }
}

// 读数：唯一接数据的一片，字晕取自身色（`0 0 5px currentColor`）
function valueTxt(
  def: Twin2dSensorDef,
  idPrefix: string,
  color: string,
): Twin2dTxtPrim {
  return {
    ...baseOf(`${idPrefix}-value`, FLOW_AT),
    kind: 'txt',
    src: { kind: 'slot', slot: def.slotKey },
    lineHeight: null,
    font: {
      family: DIGIT_FAMILY,
      size: PILL_FONT_SIZE,
      weight: BOLD_WEIGHT,
      color,
    },
    align: 'start',
    baseline: 'auto',
    nowrap: true,
    ellipsis: false,
    titleAttr: false,
    shadows: [
      {
        id: 'reading-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: READING_GLOW_BLUR,
        spread: 0,
        color: INHERITED,
      },
    ],
    outline: null,
  }
}

// 单位：⚠ 没有单位时整片不渲染（`hidden`），不是渲染成一个空 span——空 span 会把
// 药丸右边多撑出一个 gap，看着像「内边距配歪了」（§7.8 #58）
function unitTxt(
  def: Twin2dSensorDef,
  idPrefix: string,
  color: string,
): Twin2dTxtPrim {
  return {
    ...baseOf(`${idPrefix}-unit`, FLOW_AT),
    kind: 'txt',
    hidden: def.unit === '',
    opacity: UNIT_OPACITY,
    src: { kind: 'lit', text: def.unit },
    lineHeight: null,
    font: { size: UNIT_FONT_SIZE, color },
    align: 'start',
    baseline: 'auto',
    nowrap: true,
    ellipsis: false,
    titleAttr: false,
    shadows: [],
    outline: null,
  }
}

/**
 * 按一种传感器构一枚药丸：一个 `box` 套三个 `txt`。
 * @param def 这一种的身份
 * @param at 药丸落在哪儿（九档锚点、周长参数或绝对定位都行）
 * @param idPrefix 四个图元 id 的前缀，同一个节点里不许重名
 */
export function twin2dSensorPill(
  def: Twin2dSensorDef,
  at: Twin2dPlacement,
  idPrefix: string,
): Twin2dBoxPrim {
  const color = TWIN_2D_PALETTE[def.paletteKey]
  return {
    ...baseOf(`${idPrefix}-pill`, at),
    kind: 'box',
    layout: {
      flow: 'row',
      gap: PILL_GAP,
      // 三片按**基线**对齐：换成 center 时大字号的读数会把小字号的单位顶上去半行
      align: 'baseline',
      justify: 'start',
      wrap: false,
      pad: [PILL_PAD_Y, PILL_PAD_X, PILL_PAD_Y, PILL_PAD_X],
    },
    fills: [{ kind: 'solid', id: 'pill-fill', color: PILL_FILL, opacity: 1 }],
    border: {
      width: PILL_BORDER_WIDTH,
      style: 'solid',
      color,
      sides: { top: true, right: true, bottom: true, left: true },
    },
    radius: 'pill',
    shadows: [
      {
        id: 'pill-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: GLOW_BLUR,
        spread: 0,
        color: mixTransparent(color, GLOW_MIX),
      },
    ],
    backdropBlur: 0,
    clip: false,
    cursor: 'default',
    children: [
      tagTxt(def, idPrefix, color),
      valueTxt(def, idPrefix, color),
      unitTxt(def, idPrefix, color),
    ],
  }
}

/**
 * 按一种传感器构那一条读数槽位。
 * ⚠ `precision` 给 null = 整数直出、小数留一位，与参考项目 `TopologySensor.vue` 的
 * `Number.isInteger(v) ? String(v) : v.toFixed(1)` 同口径（§7.12 #91）。
 * @param def 这一种的身份
 */
export function twin2dSensorSlot(def: Twin2dSensorDef): Twin2dSlot {
  return {
    key: def.slotKey,
    label: def.label,
    kind: 'live',
    dataType: 'number',
    unit: def.unit,
    precision: null,
    format: 'auto',
    enumMap: {},
    placeholder: TWIN_2D_SENSOR_PLACEHOLDER,
    primary: false,
    expr: null,
  }
}

/** 一枚药丸的 id 前缀：`sensor-tt` 这样，四片 id 在它下面展开。 */
export function twin2dSensorIdPrefix(def: Twin2dSensorDef): string {
  return `sensor-${def.id.toLowerCase()}`
}

/** 4 枚预置药丸，落点都是缺省的上边中点外侧。 */
export const TWIN_2D_SENSOR_PILLS: readonly Twin2dBoxPrim[] =
  TWIN_2D_SENSOR_DEFS.map((def) =>
    twin2dSensorPill(def, TWIN_2D_SENSOR_DEFAULT_AT, twin2dSensorIdPrefix(def)),
  )

/** 4 条预置读数槽位，与 `TWIN_2D_SENSOR_PILLS` 同序、同 `slotKey`。 */
export const TWIN_2D_SENSOR_SLOTS: readonly Twin2dSlot[] =
  TWIN_2D_SENSOR_DEFS.map(twin2dSensorSlot)
