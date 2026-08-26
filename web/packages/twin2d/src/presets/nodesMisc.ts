/**
 * @fileoverview 两个不成族的预置节点样式：板式换热器（`square`：方块 + 居中图标 +
 * 下方外侧标签）与文字标注（`text`：一条竖色条 + 一段文字，无边框无底色）。
 * 取值出自参考项目 topology-view 的 `.tnv-square` / `.tnv-text` 两段样式块与
 * `builtinLibrary`；口径见 docs/MODULE_TWIN_2D_DESIGN.md §7.6、§7.7。
 */
import { TWIN_2D_DEFAULT_PLACEHOLDER } from '../constants'
import { TWIN_2D_PALETTE } from './palette'
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
import type { Twin2dNodeStyle, Twin2dSlot, Twin2dVariant } from '../types'
import type {
  Twin2dBoxPrim,
  Twin2dPlacement,
  Twin2dShadow,
  Twin2dTransition,
  Twin2dTxtPrim,
} from '../typesPrim'

/** `--radius-md`（8px）的取值 */
const RADIUS_MD = 8
/** 方块的下方标签比显示名小 1px，参考项目写的是 `calc(--topo-node-name-size - 1px)` */
const TILE_LABEL_SIZE = 17
/**
 * 方块 hover 那一层落影的底色。
 * ⚠ 这一档是 `.22`，`box` 一形是 `.24`——参考项目逐值不同，不许统一。
 */
const HOVER_SCRIM = 'rgba(0, 0, 0, 0.22)'

/** 参考项目 `.tnv-square__tile` 那三属性的过渡 */
const TILE_TRANSITION: Twin2dTransition = {
  props: ['border-color', 'box-shadow', 'transform'],
  durationMs: TRANSITION_MS,
  easing: 'ease',
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

/** 报警时状态点脉冲；`box` 与 `square` 另加外壳呼吸，这一条是两者共有的部分。 */
function dotPulsePatch(): Twin2dVariant['patch'] {
  return { 'status-dot': { anim: { kind: 'pulse', durationMs: ALARM_MS } } }
}

/** 方块本体：1.5px 描边、150° 渐变底、内发光加外发光，套一枚半宽半高的图标（§7.6 #41）。 */
function tileBox(): Twin2dBoxPrim {
  const glyph = spriteOf(
    primBase('glyph', IN_FLOW, { w: '50%', h: '50%' }),
    'ico-hx',
  )
  return {
    ...boxOf(primBase('tile', FILL_PARENT, AUTO_SIZE), layoutOf(FLOW_NONE), [
      glyph,
    ]),
    transition: TILE_TRANSITION,
    fills: [baseGradient()],
    border: borderOf(1.5, ACCENT),
    radius: RADIUS_MD,
    shadows: [
      accentShadow({ id: 'inner', inset: true, blur: 14, percent: 14 }),
      accentShadow({ id: 'glow', inset: false, blur: 8, percent: 24 }),
    ],
  }
}

/**
 * 方块的显示名：在节点盒**下方外侧**（§7.6 #42）。
 * ⚠ `bottom: -2` 配 `ty: '100%'` 才是「贴着底边往外整体推出去一个自己」，
 * 只给 `bottom` 会让它压在方块身上。
 */
function tileLabel(): Twin2dTxtPrim {
  const at: Twin2dPlacement = {
    kind: 'abs',
    left: '50%',
    right: null,
    top: null,
    bottom: -2,
    tx: '-50%',
    ty: '100%',
  }
  return {
    ...txtOf(primBase('label-natural', at, AUTO_SIZE), { kind: 'label' }),
    font: {
      size: TILE_LABEL_SIZE,
      weight: 600,
      color: 'var(--text-primary)',
    },
    nowrap: true,
    titleAttr: true,
    shadows: [
      accentShadow({ id: 'label-glow', inset: false, blur: 4, percent: 50 }),
    ],
  }
}

/**
 * 方块的 hover：根上抬 3px 并放大到 **1.04**（`box` 一形是 1.025、罐形是 1.02，三档逐值不同）。
 * ⚠ 这一形**不追加**径向高光——那一层只有 `box` 有（§7.2 #9 与 #12 的差别）。
 */
function tileHoverVariant(): Twin2dVariant {
  return {
    id: 'hover',
    when: { kind: 'state', state: 'hover' },
    patch: {
      tile: {
        border: borderOf(1.5, HOVER_BORDER),
        shadows: [
          accentShadow({ id: 'inner', inset: true, blur: 18, percent: 18 }),
          scrimShadow(),
          accentShadow({ id: 'glow', inset: false, blur: 18, percent: 42 }),
        ],
      },
    },
    rootPatch: { lift: 3, scale: 1.04, z: 30 },
  }
}

/** 方块的选中：一圈 2px 实色 + 一层外发光（§7.7 #48）。 */
function tileSelectedVariant(): Twin2dVariant {
  return {
    id: 'selected',
    when: { kind: 'state', state: 'selected' },
    patch: {},
    rootPatch: {
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
  }
}

/**
 * 方块的报警：描边转危险色，本体呼吸、状态点脉冲（§7.7 #49、#53）。
 * ⚠ 参考项目动的是 box-shadow 的浓度，本模型的 keyframes 是固定四档，`breathe` 动的是
 * 整枝不透明度——观感同族但不逐帧相同。
 */
function tileAlarmVariant(): Twin2dVariant {
  return {
    id: 'alarm',
    when: { kind: 'status', in: ['alarm'] },
    patch: {
      ...dotPulsePatch(),
      tile: {
        border: borderOf(1.5, 'var(--state-danger)'),
        anim: { kind: 'breathe', durationMs: ALARM_MS },
      },
    },
    rootPatch: {},
  }
}

/** 一个换热器槽位。 */
function hxSlot(spec: {
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
    enumMap: {},
    placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
    primary: spec.primary,
    expr: null,
  }
}

/**
 * 换热器的四个字段，文档序即 `nodeValues` 的行序。
 * ⚠ `status` 一档**不给 `enumMap`**：状态归一走 `toDeviceStatus`，在这里再写一张
 * 数值→文案的表就是给同一件事开第二份真源（§10.2）。
 */
function hxSlots(): readonly Twin2dSlot[] {
  return [
    hxSlot({
      key: 'temperature_c',
      label: '换热温度',
      unit: '℃',
      primary: true,
    }),
    hxSlot({ key: 'flow_m3h', label: '流量', unit: 'm³/h', primary: false }),
    hxSlot({ key: 'pressure_kpa', label: '压力', unit: 'kPa', primary: false }),
    {
      key: 'status',
      label: '状态',
      kind: 'live',
      dataType: 'enum',
      unit: '',
      precision: null,
      enumMap: {},
      placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
      primary: false,
      expr: null,
    },
  ]
}

/** 板式换热器：外壳只做居中，观感全在里面那块方砖上。 */
function heatExchangerStyle(): Twin2dNodeStyle {
  const frame = boxOf(
    primBase('frame', FILL_PARENT, AUTO_SIZE),
    layoutOf(FLOW_NONE),
    [tileBox()],
  )
  return {
    id: 'heat-exchanger',
    name: '板式换热器',
    category: 'exchanger',
    accent: TWIN_2D_PALETTE.water,
    defaultStatus: 'online',
    size: { w: 154, h: 154 },
    prims: [frame, tileLabel(), statusDot()],
    ports: [],
    slots: hxSlots(),
    variants: [tileHoverVariant(), tileSelectedVariant(), tileAlarmVariant()],
  }
}

/** 竖色条：3px 宽、一个字高，实心强调色加一圈同色发光（§7.6 #43）。 */
function labelBar(): Twin2dBoxPrim {
  return {
    ...boxOf(
      primBase('bar', IN_FLOW, { w: 3, h: '1em' }),
      layoutOf(FLOW_NONE),
      [],
    ),
    fills: [solidFill('bar-fill', ACCENT)],
    shadows: [
      {
        id: 'bar-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 6,
        spread: 0,
        color: ACCENT,
      },
    ],
  }
}

/** 标注文字：显示名一段，不省略也不挂 `title`（§7.6 #44）。 */
function labelText(): Twin2dTxtPrim {
  return {
    ...txtOf(primBase('label-natural', IN_FLOW, AUTO_SIZE), { kind: 'label' }),
    font: { size: NAME_SIZE, weight: 600, color: 'var(--text-primary)' },
    nowrap: true,
    shadows: [
      accentShadow({ id: 'label-glow', inset: false, blur: 5, percent: 45 }),
    ],
  }
}

/** 报警时只让状态点脉冲：参考项目那三条 hover / 选中 / 报警规则都不落在这一形上。 */
function labelAlarmVariant(): Twin2dVariant {
  return {
    id: 'alarm',
    when: { kind: 'status', in: ['alarm'] },
    patch: dotPulsePatch(),
    rootPatch: {},
  }
}

/**
 * 文字标注：一条竖色条加一段文字，**无边框、无底色、无 hover**。
 * ⚠ `defaultStatus: 'hidden'` 是这一件的关键一格：参考项目里 `category === 'label'`
 * 且未声明状态时 `statusColor` 回 null，也就是整个状态点不画（§7.7 #55）。
 * 分类在新模型里只用于调色板分栏，一处都不参与渲染判断，所以那条语义只能落在这里。
 */
function labelStyle(): Twin2dNodeStyle {
  const frame = boxOf(
    primBase('frame', FILL_PARENT, AUTO_SIZE),
    layoutOf({
      flow: 'row',
      gap: 6,
      align: 'center',
      justify: 'start',
      pad: [0, 0, 0, 0],
    }),
    [labelBar(), labelText()],
  )
  return {
    id: 'label',
    name: '文字标注',
    category: 'label',
    accent: 'var(--accent-primary)',
    defaultStatus: 'hidden',
    size: { w: 224, h: 50 },
    prims: [frame, statusDot()],
    ports: [],
    slots: [],
    variants: [labelAlarmVariant()],
  }
}

/**
 * 换热器与文字标注两个预置样式，文档序即调色板里的摆放序。
 * ⚠ 文字标注的强调色取 `var(--accent-primary)` 而不是调色板里的某个字面值：参考项目
 * 这一件的 `colorVar` 本来就是这个语义 token，于是它是唯一一件跟随换肤的预置样式。
 */
export const TWIN_2D_MISC_STYLES: readonly Twin2dNodeStyle[] = [
  heatExchangerStyle(),
  labelStyle(),
]
