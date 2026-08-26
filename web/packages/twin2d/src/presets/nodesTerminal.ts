/**
 * @fileoverview 三个末端预置节点样式（洗浴 / 采暖 / 空调）：`box` 形，左图标底板 + 标题 +
 * 一行主读数，四个末端字段落成槽位。三者只差强调色与图标，其余逐字段相同。
 * 取值出自参考项目 topology-view 的 `.tnv-box` 一族样式块与 `builtinLibrary` 的
 * `TERMINAL_FIELDS`；口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.1、§7.2、§7.7。
 */
import { TWIN_2D_DEFAULT_PLACEHOLDER } from '../constants'
import { TWIN_2D_LABEL_NATURAL_WHEN, twin2dWithChrome } from './chrome'
import { TWIN_2D_PALETTE, mixTransparent } from './palette'
import {
  ACCENT,
  ALARM_MS,
  AUTO_SIZE,
  FILL_PARENT,
  FLOW_NONE,
  HOVER_BORDER,
  IN_FLOW,
  NAME_SIZE,
  TRANSITION_MS,
  accentShadow,
  baseGradient,
  borderOf,
  boxOf,
  layoutOf,
  primBase,
  solidFill,
  spriteOf,
  statusDot,
  txtOf,
} from './primKit'
import type { Twin2dSpriteId } from '../kinds'
import type { Twin2dNodeStyle, Twin2dSlot, Twin2dVariant } from '../types'
import type {
  Twin2dBoxPrim,
  Twin2dFill,
  Twin2dShadow,
  Twin2dTransition,
  Twin2dTxtPrim,
} from '../typesPrim'

/** `--radius-md`（8px）与 `--radius-sm`（4px）的取值 */
const RADIUS_MD = 8
const RADIUS_SM = 4
/** 主读数字号 */
const VALUE_SIZE = 32
/**
 * hover 那一层落影的底色。
 * ⚠ 参考项目里 box 这一档是 `.24`，罐形与方块是 `.22`——逐值不同，不许统一。
 */
const HOVER_SCRIM = 'rgba(0, 0, 0, 0.24)'
/**
 * 图标底板的底色，逐字照抄参考项目。
 * ⚠ 它**不跟节点色**：换成 `--t2-accent` 派生只在换主题或换节点色时才看得出来不一致。
 */
const ICON_PLATE_FILL = 'rgba(var(--accent-primary-rgb), 0.06)'

/** 参考项目 `.tnv-box` 等四处过渡的属性表 */
const BOX_TRANSITION: Twin2dTransition = {
  props: ['border-color', 'background', 'box-shadow', 'transform'],
  durationMs: TRANSITION_MS,
  easing: 'ease',
}

/**
 * hover 追加的那一层径向高光。
 * ⚠ 参考项目写的是 `circle at 25% 0 … transparent 54%`（隐式 farthest-corner），
 * 本模型的径向必须给显式半径，故取 `r: 1`：色标位置逐值相同，半径口径是近似的。
 */
function hoverGradient(): Twin2dFill {
  return {
    kind: 'radial',
    id: 'fill-hover',
    cx: 0.25,
    cy: 0,
    r: 1,
    stops: [
      { id: 'stop-hi', color: mixTransparent(ACCENT, 18), at: 0 },
      { id: 'stop-out', color: 'transparent', at: 0.54 },
    ],
    opacity: 1,
  }
}

/** hover 那一条向下的落影。 */
function scrimShadow(): Twin2dShadow {
  return {
    id: 'scrim',
    inset: false,
    x: 0,
    y: 8,
    blur: 18,
    spread: 0,
    color: HOVER_SCRIM,
  }
}

/** 34×34 的图标底板套一枚 26×26 图标（§7.1 #2）。 */
function iconPlate(sprite: Twin2dSpriteId): Twin2dBoxPrim {
  const glyph = spriteOf(primBase('glyph', IN_FLOW, { w: 26, h: 26 }), sprite)
  return {
    ...boxOf(primBase('icon', IN_FLOW, { w: 34, h: 34 }), layoutOf(FLOW_NONE), [
      glyph,
    ]),
    transition: BOX_TRANSITION,
    fills: [solidFill('plate', ICON_PLATE_FILL)],
    border: borderOf(1, mixTransparent(ACCENT, 40)),
    radius: RADIUS_SM,
  }
}

/** 标题 + 一行主读数（§7.1 #3–#6）。 */
function bodyBox(primarySlot: string): Twin2dBoxPrim {
  const title: Twin2dTxtPrim = {
    ...txtOf(primBase('label-natural', IN_FLOW, AUTO_SIZE), { kind: 'label' }),
    when: TWIN_2D_LABEL_NATURAL_WHEN,
    font: { size: NAME_SIZE, weight: 600, color: 'var(--text-primary)' },
    nowrap: true,
    ellipsis: true,
    titleAttr: true,
  }
  const value: Twin2dTxtPrim = {
    ...txtOf(primBase('value', IN_FLOW, AUTO_SIZE), {
      kind: 'slot',
      slot: primarySlot,
    }),
    font: {
      family: 'var(--font-digit)',
      size: VALUE_SIZE,
      letterSpacing: 0.5,
      color: ACCENT,
    },
    shadows: [
      accentShadow({ id: 'value-glow', inset: false, blur: 3, percent: 70 }),
    ],
  }
  const readings = boxOf(
    primBase('readings', IN_FLOW, AUTO_SIZE),
    layoutOf({
      flow: 'row',
      gap: 8,
      align: 'baseline',
      justify: 'start',
      pad: [0, 0, 0, 0],
    }),
    [value],
  )
  return boxOf(
    primBase('body', IN_FLOW, AUTO_SIZE),
    layoutOf({
      flow: 'col',
      gap: 2,
      align: 'start',
      justify: 'start',
      pad: [0, 0, 0, 0],
    }),
    [title, readings],
  )
}

/** 外壳：1.5px 强调色描边、150° 渐变底、内发光加外发光（§7.1 #1）。 */
function frameBox(sprite: Twin2dSpriteId, primarySlot: string): Twin2dBoxPrim {
  return {
    ...boxOf(
      primBase('frame', FILL_PARENT, AUTO_SIZE),
      layoutOf({
        flow: 'row',
        gap: 8,
        align: 'center',
        justify: 'start',
        pad: [6, 10, 6, 10],
      }),
      [iconPlate(sprite), bodyBox(primarySlot)],
    ),
    transition: BOX_TRANSITION,
    fills: [baseGradient()],
    border: borderOf(1.5, ACCENT),
    radius: RADIUS_MD,
    shadows: [
      accentShadow({ id: 'inner', inset: true, blur: 14, percent: 12 }),
      accentShadow({ id: 'glow', inset: false, blur: 8, percent: 22 }),
    ],
  }
}

/**
 * hover：根上抬 3px 并放大到 **1.025**（`box` 一形的值，与罐形 1.02、方块 1.04 不同），
 * 外壳换描边色、追加一层径向高光、换三重阴影，图标底板同时放大到 1.08（§7.2 #9、#10、#14）。
 */
function hoverVariant(): Twin2dVariant {
  return {
    id: 'hover',
    when: { kind: 'state', state: 'hover' },
    patch: {
      frame: {
        border: borderOf(1.5, HOVER_BORDER),
        fills: [baseGradient(), hoverGradient()],
        shadows: [
          accentShadow({ id: 'inner', inset: true, blur: 18, percent: 18 }),
          scrimShadow(),
          accentShadow({ id: 'glow', inset: false, blur: 18, percent: 42 }),
        ],
      },
      icon: {
        scale: 1.08,
        border: borderOf(1, mixTransparent(ACCENT, 62)),
        fills: [solidFill('plate', mixTransparent(ACCENT, 16))],
        shadows: [
          accentShadow({
            id: 'plate-glow',
            inset: false,
            blur: 12,
            percent: 34,
          }),
        ],
      },
    },
    rootPatch: { lift: 3, scale: 1.025, z: 30 },
  }
}

/**
 * 选中：一圈 2px 实色 + 一层外发光（§7.7 #48）。
 * ⚠ 补丁落在 `frame` 而不是 `rootPatch.shadows`：参考项目那条 `box-shadow` 挂在有圆角的
 * 那一层（`.tnv-box` / `.tnv-tank` / `.tnv-square__tile`）上，而本模型的节点根
 * `.t2-node` **没有 border-radius**——`spread: 2` 的实边落在根上会在圆角盒**外**画出
 * 一个直角框，取值全对、只是形状不对，没有一处会报错。
 * ⚠ 整组替换而不是追加：参考项目那条 `box-shadow` 是一个属性，选中时它把常态的内外
 * 发光整条顶掉。
 */
function selectedVariant(): Twin2dVariant {
  return {
    id: 'selected',
    when: { kind: 'state', state: 'selected' },
    patch: {
      frame: {
        shadows: [
          {
            id: 'ring',
            inset: false,
            x: 0,
            y: 0,
            blur: 0,
            spread: 2,
            color: ACCENT,
          },
          accentShadow({ id: 'halo', inset: false, blur: 16, percent: 45 }),
        ],
      },
    },
    rootPatch: {},
  }
}

/**
 * 报警：描边转危险色，外壳呼吸、状态点脉冲（§7.7 #49、#53）。
 * ⚠ 参考项目动的是 box-shadow 的浓度，本模型的 keyframes 是固定四档，`breathe` 动的是
 * 整枝不透明度——观感同族但不逐帧相同。
 */
function alarmVariant(): Twin2dVariant {
  return {
    id: 'alarm',
    when: { kind: 'status', in: ['alarm'] },
    patch: {
      frame: {
        border: borderOf(1.5, 'var(--state-danger)'),
        anim: { kind: 'breathe', durationMs: ALARM_MS },
      },
      'status-dot': { anim: { kind: 'pulse', durationMs: ALARM_MS } },
    },
    rootPatch: {},
  }
}

/** 一个末端槽位。 */
function slotOf(spec: {
  key: string
  label: string
  unit: string
  primary: boolean
}): Twin2dSlot {
  return {
    key: spec.key,
    label: spec.label,
    kind: 'live',
    dataType: 'number',
    unit: spec.unit,
    precision: null,
    format: 'auto',
    enumMap: {},
    placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
    primary: spec.primary,
    expr: null,
  }
}

/**
 * 四个末端字段，文档序即 `nodeValues` 的行序。
 * ⚠ `status` 一档**不给 `enumMap`**：状态归一走 `toDeviceStatus`，在这里再写一张
 * 数值→文案的表就是给同一件事开第二份真源（§10.2）。
 */
function terminalSlots(): readonly Twin2dSlot[] {
  return [
    slotOf({ key: 'today_kwh', label: '今日用能', unit: 'kWh', primary: true }),
    slotOf({ key: 'demand_kw', label: '需求', unit: 'kW', primary: false }),
    slotOf({
      key: 'satisfaction_pct',
      label: '满足度',
      unit: '%',
      primary: false,
    }),
    {
      key: 'status',
      label: '状态',
      kind: 'live',
      dataType: 'enum',
      unit: '',
      precision: null,
      format: 'auto',
      enumMap: {},
      placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
      primary: false,
      expr: null,
    },
  ]
}

/** 主读数取的槽键，与 `TERMINAL_FIELDS` 的 primary 同一个 */
const PRIMARY_SLOT = 'today_kwh'

/** 一个末端样式：三者只差 id、名字、强调色与图标。 */
function terminalStyle(spec: {
  id: string
  name: string
  accent: string
  sprite: Twin2dSpriteId
}): Twin2dNodeStyle {
  return twin2dWithChrome({
    id: spec.id,
    name: spec.name,
    category: 'terminal',
    accent: spec.accent,
    defaultStatus: 'online',
    size: { w: 196, h: 112 },
    prims: [frameBox(spec.sprite, PRIMARY_SLOT), statusDot()],
    ports: [],
    slots: terminalSlots(),
    variants: [hoverVariant(), selectedVariant(), alarmVariant()],
  })
}

/**
 * 三个末端预置样式，文档序即调色板里的摆放序。
 * ⚠ 强调色逐个不同且不跟随换肤：洗浴取冷色、采暖取热色、空调取水色，与参考项目
 * `builtinLibrary` 的 `--chart-cold` / `--chart-hot` / `--chart-series-5` 逐值同色（§6.1）。
 */
export const TWIN_2D_TERMINAL_STYLES: readonly Twin2dNodeStyle[] = [
  terminalStyle({
    id: 'bath-terminal',
    name: '洗浴终端',
    accent: TWIN_2D_PALETTE.tempCold,
    sprite: 'ico-term-shower',
  }),
  terminalStyle({
    id: 'heating-terminal',
    name: '采暖终端',
    accent: TWIN_2D_PALETTE.tempHot,
    sprite: 'ico-term-radiator',
  }),
  terminalStyle({
    id: 'ac-terminal',
    name: '空调终端',
    accent: TWIN_2D_PALETTE.water,
    sprite: 'ico-term-ac',
  }),
]
