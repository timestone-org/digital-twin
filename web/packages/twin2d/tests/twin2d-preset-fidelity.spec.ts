/**
 * @fileoverview 逐像素兼容的机械保证：docs/MODULE_TWIN_2D_DESIGN.md §7 那张 100 行验收
 * 清单，每一行一条断言，用例名带行号（`§7-33 …`），红了能直接对回文档。
 *
 * ⚠ 期望值一律回到参考项目源码核对过（`TopologyNodeView.vue` 的 96 个选择器块、
 * `TopologyViewer.vue`、`TopologySensor.vue` 与 `render/` 下的六个 .ts），不照抄文档
 * 那一列转述：转述读错了，这份测试就把错误值锁死，比没有测试更糟。
 * ⚠ ⛔ 与「参考项目里根本没有」的那几件同样要有断言——否则将来有人顺手补上，
 * 就凭空多出参考项目没有的功能，而这一步不会有任何一处报错。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'

import {
  TWIN_2D_DEFAULT_CORNER_RADIUS,
  TWIN_2D_DEFAULT_FIT_PADDING,
  TWIN_2D_DEFAULT_PATTERN_GAP,
  TWIN_2D_DEFAULT_PATTERN_WIDTH,
  TWIN_2D_DEFAULT_PLACEHOLDER,
  TWIN_2D_MAX_FIT_PADDING,
  TWIN_2D_MIN_FIT_PADDING,
} from '../src/constants'
import { resolveAccent } from '../src/cssValue'
import { edgePath, roundCorners } from '../src/edgePath'
import { buildEdgeViews } from '../src/edgeView'
import { evalExpr, exprSlotRefs } from '../src/expr'
import { fmtKwh, fmtNumber, fmtTrim, formatSlotValue } from '../src/format'
import { collectTwin2dIssues } from '../src/issues'
import {
  TWIN_2D_ANCHORS,
  TWIN_2D_BADGE_SHAPES,
  TWIN_2D_FIXED_COLOR_SPRITES,
  TWIN_2D_LABEL_POSITIONS,
  TWIN_2D_ICO_SRC_KINDS,
  TWIN_2D_PRIM_KINDS,
  TWIN_2D_ROUTE_KINDS,
  TWIN_2D_SPRITE_GRADIENT_IDS,
  TWIN_2D_SPRITE_IDS,
  TWIN_2D_STATES,
  TWIN_2D_STATUSES,
  TWIN_2D_TRANSITION_PROPS,
  TWIN_2D_TXT_SRC_KINDS,
} from '../src/kinds'
import { normalizeTwin2dConfig } from '../src/normalize'
import { normalizeEdge } from '../src/normalizeEdges'
import { normalizeMark } from '../src/normalizeMarks'
import { normalizeNode } from '../src/normalizeNodes'
import { normalizePrim } from '../src/normalizePrims'
import { evalCondition } from '../src/variants'
import {
  TWIN_2D_BOX_CONSTANTS,
  injectVars,
  statusColor,
} from '../src/paintCommon'
import { paintText } from '../src/paintText'
import { anchor9Css, perimCss } from '../src/placement'
import { TWIN_2D_CIRCUIT_STYLES } from '../src/presets/circuit'
import { TWIN_2D_EDGE_PRESETS } from '../src/presets/edges'
import { TWIN_2D_MISC_STYLES } from '../src/presets/nodesMisc'
import { TWIN_2D_SOURCE_STYLES } from '../src/presets/nodesSource'
import { TWIN_2D_TERMINAL_STYLES } from '../src/presets/nodesTerminal'
import { TWIN_2D_VESSEL_STYLES } from '../src/presets/nodesVessel'
import { TWIN_2D_PALETTE, TWIN_2D_PALETTE_RGB } from '../src/presets/palette'
import {
  TWIN_2D_SENSOR_DEFAULT_AT,
  TWIN_2D_SENSOR_DEFS,
  TWIN_2D_SENSOR_PILLS,
  TWIN_2D_SENSOR_PLACEHOLDER,
  TWIN_2D_SENSOR_SLOTS,
  twin2dSensorPill,
} from '../src/presets/sensors'
import {
  TWIN_2D_SOURCE_SUBTYPE_DEFS,
  TWIN_2D_TERMINAL_SUBTYPE_DEFS,
} from '../src/presets/subtypes'
import Twin2dStage from '../src/render/Twin2dStage.vue'
import type { Twin2dEdgeState, Twin2dEdgeView } from '../src/edgeView'
import type { Twin2dSlotFormat } from '../src/format'
import type { Twin2dAnchor9, Twin2dValueFormat } from '../src/kinds'
import type { Twin2dVariantCtx } from '../src/variants'
import type {
  Twin2dEdge,
  Twin2dEdgeStyle,
  Twin2dMark,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dSlot,
  Twin2dVariant,
} from '../src/types'
import type {
  Twin2dBoxPrim,
  Twin2dExpr,
  Twin2dFill,
  Twin2dIcoPrim,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dRadius,
  Twin2dShadow,
  Twin2dStrokePass,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../src/typesPrim'

// ⚠ 舞台在卸载时才把 sprite 宿主的文档级标记还回去，不逐条卸载会让后面的用例领不到宿主
enableAutoUnmount(afterEach)

/** ⚠ 从 `process.cwd()`（web workspace 根）拼路径：happy-dom 那一趟里
 *  `import.meta.url` 不是 `file:` 协议，`fileURLToPath` 会当场抛。 */
const PKG = join(process.cwd(), 'packages', 'twin2d')
const SRC = join(PKG, 'src')
const RENDER = join(SRC, 'render')
const SCSS = readFileSync(join(RENDER, 'twin2d.scss'), 'utf8')
const SPRITE_SVG = readFileSync(join(RENDER, 'icons.svg'), 'utf8')
const SPEC_SELF = readFileSync(
  join(PKG, 'tests', 'twin2d-preset-fidelity.spec.ts'),
  'utf8',
)

/** 全部节点预置样式，四族按调色板摆放序。 */
const ALL_NODE_STYLES: readonly Twin2dNodeStyle[] = [
  ...TWIN_2D_SOURCE_STYLES,
  ...TWIN_2D_VESSEL_STYLES,
  ...TWIN_2D_TERMINAL_STYLES,
  ...TWIN_2D_MISC_STYLES,
]

/** 节点根注入的强调色变量，预置图元一律引它。 */
const ACCENT = 'var(--t2-accent)'

/** 掺进透明底的一档取值，与 `mixTransparent` 同形。 */
function mix(percent: number): string {
  return `color-mix(in srgb, ${ACCENT} ${percent}%, transparent)`
}

function styleOf(id: string): Twin2dNodeStyle {
  const found = ALL_NODE_STYLES.find((style) => style.id === id)
  if (found === undefined) throw new Error(`没有预置节点样式 ${id}`)
  return found
}

function searchPrims(
  prims: readonly Twin2dPrim[],
  id: string,
): Twin2dPrim | null {
  for (const prim of prims) {
    if (prim.id === id) return prim
    if (prim.kind === 'box') {
      const hit = searchPrims(prim.children, id)
      if (hit !== null) return hit
    }
  }
  return null
}

function primOf(styleId: string, primId: string): Twin2dPrim {
  const hit = searchPrims(styleOf(styleId).prims, primId)
  if (hit === null) throw new Error(`样式 ${styleId} 里没有图元 ${primId}`)
  return hit
}

function asBox(prim: Twin2dPrim): Twin2dBoxPrim {
  if (prim.kind !== 'box') throw new Error(`图元 ${prim.id} 不是 box`)
  return prim
}

function asTxt(prim: Twin2dPrim): Twin2dTxtPrim {
  if (prim.kind !== 'txt') throw new Error(`图元 ${prim.id} 不是 txt`)
  return prim
}

function asIco(prim: Twin2dPrim): Twin2dIcoPrim {
  if (prim.kind !== 'ico') throw new Error(`图元 ${prim.id} 不是 ico`)
  return prim
}

function asVec(prim: Twin2dPrim): Twin2dVecPrim {
  if (prim.kind !== 'vec') throw new Error(`图元 ${prim.id} 不是 vec`)
  return prim
}

function boxOf(styleId: string, primId: string): Twin2dBoxPrim {
  return asBox(primOf(styleId, primId))
}

function txtOf(styleId: string, primId: string): Twin2dTxtPrim {
  return asTxt(primOf(styleId, primId))
}

function vecOf(styleId: string, primId: string): Twin2dVecPrim {
  return asVec(primOf(styleId, primId))
}

function variantOf(styleId: string, variantId: string): Twin2dVariant {
  const found = styleOf(styleId).variants.find((one) => one.id === variantId)
  if (found === undefined)
    throw new Error(`样式 ${styleId} 没有变体 ${variantId}`)
  return found
}

function patchOf(
  styleId: string,
  variantId: string,
  primId: string,
): Twin2dPrimPatch {
  const patch = variantOf(styleId, variantId).patch[primId]
  if (patch === undefined) throw new Error(`变体 ${variantId} 没有补 ${primId}`)
  return patch
}

function fillAt(fills: readonly Twin2dFill[], index: number): Twin2dFill {
  const fill = fills[index]
  if (fill === undefined) throw new Error(`没有第 ${index} 层填充`)
  return fill
}

function shadowAt(
  shadows: readonly Twin2dShadow[],
  index: number,
): Twin2dShadow {
  const shadow = shadows[index]
  if (shadow === undefined) throw new Error(`没有第 ${index} 条阴影`)
  return shadow
}

function strokeAt(
  strokes: readonly Twin2dStrokePass[],
  index: number,
): Twin2dStrokePass {
  const pass = strokes[index]
  if (pass === undefined) throw new Error(`没有第 ${index} 遍描边`)
  return pass
}

/** 一条阴影压成 `[inset, x, y, blur, spread, color]`，好逐值比。 */
function shadowTuple(
  shadow: Twin2dShadow,
): [boolean, number, number, number, number, string] {
  return [
    shadow.inset,
    shadow.x,
    shadow.y,
    shadow.blur,
    shadow.spread,
    shadow.color,
  ]
}

/** 一份源码文件：文件名与正文。 */
type SourceFile = readonly [string, string]

function filesIn(dir: string, keep: (name: string) => boolean): SourceFile[] {
  const out: SourceFile[] = []
  for (const name of readdirSync(dir)) {
    if (!keep(name)) continue
    out.push([name, readFileSync(join(dir, name), 'utf8')])
  }
  return out
}

function isTsFile(name: string): boolean {
  return name.endsWith('.ts')
}

/** 预置库那一批数据文件。 */
function presetSources(): SourceFile[] {
  return filesIn(join(SRC, 'presets'), isTsFile)
}

/** 渲染件（.vue）与四种 paint*：「零 styleId 分支」那条线扫的就是这一批。 */
function renderAndPaintSources(): SourceFile[] {
  return [
    ...filesIn(RENDER, (name) => name.endsWith('.vue')),
    ...filesIn(SRC, (name) => name.startsWith('paint') && isTsFile(name)),
  ]
}

/** 包里全部源码：src 顶层的 .ts + 渲染件 + 预置数据。 */
function allSources(): SourceFile[] {
  return [
    ...filesIn(SRC, isTsFile),
    ...filesIn(RENDER, (name) => name.endsWith('.vue')),
    ...presetSources(),
  ]
}

function nodeOf(raw: Record<string, unknown>): Twin2dNode {
  const node = normalizeNode(raw)
  if (node === null) throw new Error('节点归一化失败')
  return node
}

function edgeOf(
  raw: Record<string, unknown>,
  ids: ReadonlySet<string>,
): Twin2dEdge {
  const edge = normalizeEdge(raw, ids)
  if (edge === null) throw new Error('连线归一化失败')
  return edge
}

function anchorOf(name: string): Twin2dAnchor9 {
  const found = TWIN_2D_ANCHORS.find((one) => one === name)
  if (found === undefined) throw new Error(`没有锚点 ${name}`)
  return found
}

function slotOf(styleId: string, key: string): Twin2dSlot {
  const slot = styleOf(styleId).slots.find((one) => one.key === key)
  if (slot === undefined) throw new Error(`样式 ${styleId} 没有槽位 ${key}`)
  return slot
}

function exprOf(styleId: string, key: string): Twin2dExpr {
  const expr = slotOf(styleId, key).expr
  if (expr === null) throw new Error(`槽位 ${key} 不是派生槽`)
  return expr
}

/** 角标底色的注入变量名，`node.badgeColor || accent` 都落到它上面。 */
const BADGE_VAR = 'var(--t2-badge)'

/** 外置显示名自带的那一档定位（`top`），另外三档由变体补。 */
const NAME_AT_TOP = {
  kind: 'abs',
  left: '50%',
  right: null,
  top: 0,
  bottom: null,
  tx: '-50%',
  ty: 'calc(-100% - 4px)',
}

/** 只给一个 `labelPos` 的求值上下文，其余全空。 */
function labelPosCtx(pos: string): Twin2dVariantCtx {
  return {
    states: new Set(),
    status: null,
    tags: new Map(),
    slots: new Map(),
    fields: new Map([['labelPos', pos]]),
  }
}

/** 某一档 `labelPos` 下，这枚显示名图元画不画。 */
function labelShownAt(primId: string, pos: string): boolean {
  const prim = searchPrims(styleOf(SOURCE).prims, primId)
  if (prim === null || prim.when === null) throw new Error(`${primId} 没有条件`)
  return evalCondition(prim.when, labelPosCtx(pos))
}

/** `label-<档>` 那条变体打在外置显示名上的补丁。 */
function labelPatchAt(pos: string): Twin2dPrimPatch {
  return patchOf(SOURCE, `label-${pos}`, 'label-outer')
}

/**
 * 一份只填了格式化用得上那五项的槽位口径。
 * @param format 格式档
 * @param precision 小数位
 * @param unit 单位
 */
function fmtSlot(
  format: Twin2dValueFormat,
  precision: number | null,
  unit: string,
): Twin2dSlotFormat {
  return {
    format,
    precision,
    unit,
    enumMap: {},
    placeholder: TWIN_2D_DEFAULT_PLACEHOLDER,
  }
}

function sensorSlotOf(key: string): Twin2dSlot {
  const slot = TWIN_2D_SENSOR_SLOTS.find((one) => one.key === key)
  if (slot === undefined) throw new Error(`没有传感器槽位 ${key}`)
  return slot
}

/** 一条派生槽算式引不引某个槽键。 */
function exprMentions(slot: Twin2dSlot, key: string): boolean {
  return slot.expr === null ? false : exprSlotRefs(slot.expr).includes(key)
}

function edgeStyleOf(id: string): Twin2dEdgeStyle {
  const found = TWIN_2D_EDGE_PRESETS.find((style) => style.id === id)
  if (found === undefined) throw new Error(`没有预置连线样式 ${id}`)
  return found
}

/** 一份预置连线样式里最上面那一遍描边（流动加在它身上）。 */
function lastStroke(presetIndex: number): Twin2dStrokePass {
  const style = TWIN_2D_EDGE_PRESETS[presetIndex]
  if (style === undefined) throw new Error(`没有第 ${presetIndex} 份预置连线`)
  return strokeAt(style.strokes, style.strokes.length - 1)
}

/**
 * 一条 `water` 连线的绘制输入：两个水箱节点，端点不给引脚、靠朝向解析。
 * @param animate 流动总闸
 * @param speed 全局倍率
 * @param states 按连线 id 的运行态
 */
function edgeViews(
  animate: boolean,
  speed: number,
  states: Readonly<Record<string, Twin2dEdgeState>> = {},
): Twin2dEdgeView[] {
  const ids = new Set(['a', 'b'])
  return buildEdgeViews({
    edges: [
      edgeOf(
        {
          id: 'e1',
          styleId: 'water',
          from: { nodeId: 'a' },
          to: { nodeId: 'b' },
        },
        ids,
      ),
    ],
    edgeStyles: TWIN_2D_EDGE_PRESETS,
    nodes: [
      nodeOf({ id: 'a', styleId: 'water-tank', x: 0, y: 0, w: 100, h: 60 }),
      nodeOf({ id: 'b', styleId: 'water-tank', x: 300, y: 0, w: 100, h: 60 }),
    ],
    nodeStyles: TWIN_2D_VESSEL_STYLES,
    states,
    flow: { animate, speed },
  })
}

/** 舞台那几条只能靠挂载才测得出的用例共用的最小样式。 */
const STAGE_STYLE = {
  id: 'ns',
  name: '方块',
  size: { w: 100, h: 60 },
  defaultStatus: 'online',
  prims: [{ id: 'frame', kind: 'box' }],
}

/** 舞台可覆盖的三项。 */
interface StageOverrides {
  canvas?: Record<string, unknown>
  nodes?: readonly unknown[]
  marks?: readonly unknown[]
}

/** 两个标注插槽：各自把收到的标注 id 列出来，好断言「哪一条进了哪一层」。 */
function markSlots() {
  const line = (test: string) => (props: { marks: readonly Twin2dMark[] }) =>
    h('i', { 'data-test': test }, props.marks.map((mark) => mark.id).join(','))
  return { 'marks-below': line('below'), 'marks-above': line('above') }
}

/**
 * 挂一个舞台。
 * @param over 画布 / 节点 / 标注的覆盖
 * @param box 容器尺寸（happy-dom 量不出真实布局，必须显式喂）
 * @param withSlots 要不要挂那两个标注插槽
 */
function mountStage(
  over: StageOverrides,
  box: { w: number; h: number },
  withSlots = false,
) {
  const doc = normalizeTwin2dConfig({
    canvas: { width: 400, height: 200, ...over.canvas },
    styles: [STAGE_STYLE],
    edgeStyles: [],
    nodes: over.nodes ?? [
      { id: 'a', styleId: 'ns', x: 0, y: 0, w: 100, h: 60 },
    ],
    edges: [],
    marks: over.marks ?? [],
  })
  return mount(Twin2dStage, {
    props: {
      canvas: doc.canvas,
      nodes: doc.nodes,
      edges: doc.edges,
      marks: doc.marks,
      nodeStyles: doc.styles,
      edgeStyles: doc.edgeStyles,
      containerSize: box,
    },
    ...(withSlots ? { slots: markSlots() } : {}),
  })
}

function viewportStyleOf(wrapper: ReturnType<typeof mountStage>): string {
  return wrapper.get('.t2-stage__viewport').attributes('style') ?? ''
}

/** icons.svg 里一枚 symbol 的可断言事实。 */
interface SpriteSymbol {
  viewBox: string
  /** 去重并升序的硬编码色值。 */
  colors: string[]
  currentColor: number
  gradients: string[]
  stops: string[]
}

/** 逐个 `<symbol>` 连同它的内容。 */
const SYMBOL_RE = /<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g
/**
 * 硬编码色值。
 * ⚠ 后面那个否定环视是必需的：`url(#hxFill)` 与 `href="#ico-tap"` 也以 `#` 开头，
 * 少了它，纯 `currentColor` 的那 7 枚会被误判成多色。
 */
const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-zA-Z_-])/g
const GRADIENT_RE = /<(?:linear|radial)Gradient\b[^>]*\bid="([^"]+)"/g
const STOP_RE = /<stop\b[^>]*\bstop-color="([^"]+)"/g

function symbolBody(id: string): SourceFile {
  for (const match of SPRITE_SVG.matchAll(SYMBOL_RE)) {
    const attrs = match[1] ?? ''
    if (attrs.includes(`id="${id}"`)) return [attrs, match[2] ?? '']
  }
  throw new Error(`icons.svg 里没有 ${id}`)
}

function symbolOf(id: string): SpriteSymbol {
  const [attrs, body] = symbolBody(id)
  const hexes = (body.match(HEX_RE) ?? []).map((hex) => hex.toUpperCase())
  return {
    viewBox: /viewBox="([^"]+)"/.exec(attrs)?.[1] ?? '',
    colors: [...new Set(hexes)].sort(),
    currentColor: (body.match(/currentColor/g) ?? []).length,
    gradients: [...body.matchAll(GRADIENT_RE)].map((one) => one[1] ?? ''),
    stops: [...body.matchAll(STOP_RE)].map((one) =>
      (one[1] ?? '').toUpperCase(),
    ),
  }
}

/** 这一枚的颜色是不是写死在 sprite 里（`ico.color` 对它无效）。 */
function isFixedColor(id: string): boolean {
  return TWIN_2D_FIXED_COLOR_SPRITES.some((one) => one === id)
}

function subtypeSprite(id: string): string {
  const def = TWIN_2D_SOURCE_SUBTYPE_DEFS.find((one) => one.id === id)
  if (def === undefined) throw new Error(`没有源子类 ${id}`)
  return def.sprite
}

function terminalSprite(id: string): string {
  const def = TWIN_2D_TERMINAL_SUBTYPE_DEFS.find((one) => one.id === id)
  if (def === undefined) throw new Error(`没有末端子类 ${id}`)
  return def.sprite
}

/** 预置库里全部落库 id：节点 / 电路 / 连线 / 传感器 / 两族子类。 */
function presetIds(): string[] {
  return [
    ...ALL_NODE_STYLES.map((style) => style.id),
    ...TWIN_2D_CIRCUIT_STYLES.map((style) => style.id),
    ...TWIN_2D_EDGE_PRESETS.map((style) => style.id),
    ...TWIN_2D_SENSOR_DEFS.map((def) => def.id),
    ...TWIN_2D_SOURCE_SUBTYPE_DEFS.map((def) => def.id),
    ...TWIN_2D_TERMINAL_SUBTYPE_DEFS.map((def) => def.id),
  ]
}

/**
 * 图元一侧的闭合词汇表。
 * ⚠ 与预置 id 撞名的那几个字面量（眼下只有 `'label'`——它同时是 txt 的取值来源档）
 * 在渲染件里是**正当**出现，扫描要放过；重叠本身由一条独立用例锁住，多一个就红。
 */
const KIND_WORDS: ReadonlySet<string> = new Set([
  ...TWIN_2D_TXT_SRC_KINDS,
  ...TWIN_2D_PRIM_KINDS,
  ...TWIN_2D_ICO_SRC_KINDS,
  ...TWIN_2D_STATES,
  ...TWIN_2D_STATUSES,
  ...TWIN_2D_ROUTE_KINDS,
])

/** 四种预置源里那一枚源类样式，四个只差 id / 名字 / 强调色 / 图标。 */
const SOURCE = 'waste-heat-source'
/** 末端一族取洗浴那一个。 */
const TERMINAL = 'bath-terminal'

describe('§7.1 shape=box（7 件）', () => {
  it('§7-1 .tnv-box 容器：row/gap 8/pad 6 10、1.5px accent 描边、radius-md、150° 渐变、内 14px 12% + 外 8px 22%', () => {
    const frame = boxOf(SOURCE, 'frame')

    expect(frame.layout).toEqual({
      flow: 'row',
      gap: 8,
      align: 'center',
      justify: 'start',
      wrap: false,
      pad: [6, 10, 6, 10],
    })
    expect(frame.border.width).toBe(1.5)
    expect(frame.border.color).toBe(ACCENT)
    expect(frame.radius).toBe(8)
    const base = fillAt(frame.fills, 0)
    expect(base.kind === 'linear' ? base.angle : null).toBe(150)
    expect(
      base.kind === 'linear' ? base.stops.map((s) => s.color) : [],
    ).toEqual(['var(--t2-fill-a)', 'var(--t2-fill-b)'])
    expect(shadowTuple(shadowAt(frame.shadows, 0))).toEqual([
      true,
      0,
      0,
      14,
      0,
      mix(12),
    ])
    expect(shadowTuple(shadowAt(frame.shadows, 1))).toEqual([
      false,
      0,
      0,
      8,
      0,
      mix(22),
    ])
  })

  it('§7-2 .tnv-box__icon 图标底板：34×34、radius-sm、底色照抄写死的 rgba(--accent-primary-rgb, .06)、border 1px accent40%、内 svg 26×26', () => {
    const plate = boxOf(SOURCE, 'icon')
    const glyph = asIco(primOf(SOURCE, 'glyph'))

    expect(plate.size).toEqual({ w: 34, h: 34 })
    expect(plate.layout.flow).toBe('none')
    expect(plate.radius).toBe(4)
    const fill = fillAt(plate.fills, 0)
    // ⚠ 不跟节点色：换成 --t2-accent 派生只在换主题或换节点色时才看得出不一致
    expect(fill.kind === 'solid' ? fill.color : '').toBe(
      'rgba(var(--accent-primary-rgb), 0.06)',
    )
    expect(plate.border.width).toBe(1)
    expect(plate.border.color).toBe(mix(40))
    expect(glyph.size).toEqual({ w: 26, h: 26 })
  })

  it('§7-3 .tnv-box__body：col/gap 2，min-width:0 由 box 恒定输出', () => {
    const body = boxOf(SOURCE, 'body')

    expect(body.layout.flow).toBe('col')
    expect(body.layout.gap).toBe(2)
    expect(TWIN_2D_BOX_CONSTANTS['min-width']).toBe('0')
  })

  it('§7-4 .tnv-box__title：18px/600/--text-primary、nowrap + 省略号、完整文本挂 title', () => {
    const title = txtOf(SOURCE, 'label-natural')

    expect(title.src).toEqual({ kind: 'label' })
    expect(title.font).toEqual({
      size: 18,
      weight: 600,
      color: 'var(--text-primary)',
    })
    expect([title.nowrap, title.ellipsis, title.titleAttr]).toEqual([
      true,
      true,
      true,
    ])
  })

  it('§7-5 .tnv-box__readings：row / 基线对齐 / gap 8', () => {
    const readings = boxOf(TERMINAL, 'readings')

    expect(readings.layout.flow).toBe('row')
    expect(readings.layout.align).toBe('baseline')
    expect(readings.layout.gap).toBe(8)
  })

  it('§7-6 .tnv-val 主读数：--font-digit / 32px / ls .5 / accent / 字晕 3px 70%', () => {
    const value = txtOf(TERMINAL, 'value')

    expect(value.font).toEqual({
      family: 'var(--font-digit)',
      size: 32,
      letterSpacing: 0.5,
      color: ACCENT,
    })
    expect(shadowTuple(shadowAt(value.shadows, 0))).toEqual([
      false,
      0,
      0,
      3,
      0,
      mix(70),
    ])
  })

  it('§7-7 tnv--energy 三件套：space-between / gap 10 / 大字降到 28px，显示条件是三个能量槽任一有值', () => {
    const readings = boxOf(SOURCE, 'readings')
    const value = txtOf(SOURCE, 'output-value')

    expect(readings.layout.justify).toBe('between')
    expect(readings.layout.gap).toBe(10)
    expect(value.font.size).toBe(28)
    // ⚠ 不是分支而是图元的 when：形状与内容在新模型里本来就是分开的两件事
    expect(readings.when).toEqual({
      kind: 'has',
      slots: ['input_kwh', 'output_kwh', 'efficiency_pct'],
      mode: 'any',
    })
  })
})

describe('§7.2 悬停、过渡与合成层（10 件）', () => {
  it('§7-8 七处 0.18s ease：六处落在预置图元上、逐处 180ms + ease，过渡属性表闭合六档且没有 stroke 那两项', () => {
    const carriers = [
      boxOf(SOURCE, 'frame').transition,
      boxOf(SOURCE, 'icon').transition,
      boxOf(SOURCE, 'energy-pct').transition,
      boxOf(SOURCE, 'energy-tip').transition,
      boxOf('water-tank', 'frame').transition,
      boxOf('heat-exchanger', 'frame').transition,
    ]

    for (const transition of carriers) {
      expect(transition?.durationMs).toBe(180)
      expect(transition?.easing).toBe('ease')
    }
    expect(boxOf(SOURCE, 'energy-tip').transition?.props).toEqual([
      'opacity',
      'transform',
    ])
    // ⚠ `.tnv-cyl__outline` 那一处补间的是 stroke / stroke-width / filter，
    //   而属性表里只有 filter 一档——描边那两项在本模型里表达不了
    expect([...TWIN_2D_TRANSITION_PROPS]).toEqual([
      'transform',
      'opacity',
      'background',
      'border-color',
      'box-shadow',
      'filter',
    ])
  })

  it('§7-9 hover box：抬 3px + 放大 1.025、描边掺 text-primary 86%、**追加**一层左上径向、三重阴影 18px 18% / 0 8px 18px .24 / 18px 42%', () => {
    const variant = variantOf(SOURCE, 'hover')
    const frame = patchOf(SOURCE, 'hover', 'frame')

    expect(variant.when).toEqual({ kind: 'state', state: 'hover' })
    expect(variant.rootPatch.lift).toBe(3)
    expect(variant.rootPatch.scale).toBe(1.025)
    expect(frame.border?.color).toBe(
      `color-mix(in srgb, ${ACCENT} 86%, var(--text-primary))`,
    )
    // 常态那层渐变照旧，顶上追加一层 25% 0 的光斑
    expect(frame.fills?.length).toBe(2)
    const halo = fillAt(frame.fills ?? [], 1)
    expect(halo.kind === 'radial' ? [halo.cx, halo.cy] : []).toEqual([0.25, 0])
    expect(halo.kind === 'radial' ? halo.stops.map((s) => s.at) : []).toEqual([
      0, 0.54,
    ])
    expect((frame.shadows ?? []).map(shadowTuple)).toEqual([
      [true, 0, 0, 18, 0, mix(18)],
      [false, 0, 8, 18, 0, 'rgba(0, 0, 0, 0.24)'],
      [false, 0, 0, 18, 0, mix(42)],
    ])
  })

  it('§7-10 hover 图标底板：scale 1.08 / border 62% / 底色 accent16% / 发光 12px 34%', () => {
    const icon = patchOf(SOURCE, 'hover', 'icon')

    expect(icon.scale).toBe(1.08)
    expect(icon.border?.color).toBe(mix(62))
    const fill = fillAt(icon.fills ?? [], 0)
    expect(fill.kind === 'solid' ? fill.color : '').toBe(mix(16))
    expect(shadowTuple(shadowAt(icon.shadows ?? [], 0))).toEqual([
      false,
      0,
      0,
      12,
      0,
      mix(34),
    ])
  })

  it('§7-11 hover tank：scale 1.02（≠ box 的 1.025）/ 内 20px 18% / 落影 .22（≠ box 的 .24）/ 外 18px 40%（≠ box 的 42%）', () => {
    const variant = variantOf('water-tank', 'hover')
    const frame = patchOf('water-tank', 'hover', 'frame')

    expect(variant.rootPatch.lift).toBe(3)
    expect(variant.rootPatch.scale).toBe(1.02)
    expect((frame.shadows ?? []).map(shadowTuple)).toEqual([
      [true, 0, 0, 20, 0, mix(18)],
      [false, 0, 8, 18, 0, 'rgba(0, 0, 0, 0.22)'],
      [false, 0, 0, 18, 0, mix(40)],
    ])
  })

  it('§7-12 hover square 的可见面：scale 1.04 + 抬 3px（参考项目这一件同样 translateY(-3px)）/ 内 18px 18% / .22 / 18px 42%', () => {
    const variant = variantOf('heat-exchanger', 'hover')
    const tile = patchOf('heat-exchanger', 'hover', 'frame')

    expect(variant.rootPatch.scale).toBe(1.04)
    // ⚠ 参考项目 `.tnv:hover .tnv-square__tile` 是 `translateY(-3px) scale(1.04)`，
    //   与 box / tank 同样抬 3px；文档 §7 那一行写成「没有抬升」是转述错
    expect(variant.rootPatch.lift).toBe(3)
    expect((tile.shadows ?? []).map(shadowTuple)).toEqual([
      [true, 0, 0, 18, 0, mix(18)],
      [false, 0, 8, 18, 0, 'rgba(0, 0, 0, 0.22)'],
      [false, 0, 0, 18, 0, mix(42)],
    ])
  })

  it('§7-13 hover cyl 体身：描边转 accent、线宽 1.8、外加 8px 64% 的光', () => {
    const outline = patchOf('manifold', 'hover', 'frame')
    const pass = strokeAt(outline.strokes ?? [], 0)

    expect(pass.width).toBe(1.8)
    expect(pass.color).toBe(ACCENT)
    expect(
      shadowTuple(
        shadowAt(variantOf('manifold', 'hover').rootPatch.shadows ?? [], 0),
      ),
    ).toEqual([false, 0, 0, 8, 0, mix(64)])
  })

  it('§7-14 hover 抬 z 到 30：不抬的话能量悬浮卡被右邻节点整块盖住', () => {
    const lifted = [
      'waste-heat-source',
      'water-tank',
      'manifold',
      TERMINAL,
      'heat-exchanger',
    ]

    for (const id of lifted) {
      expect(variantOf(id, 'hover').rootPatch.z).toBe(30)
    }
  })

  it('§7-15 五处 pointer-events:none：悬浮卡 / 圆柱文字层 / 管接头 / 外置显示名 / 传感器药丸', () => {
    expect(boxOf(SOURCE, 'energy-tip').pointerEvents).toBe('none')
    expect(boxOf('manifold', 'body').pointerEvents).toBe('none')
    expect(boxOf('water-tank', 'stubs').pointerEvents).toBe('none')
    // ⚠ 第五处：外置显示名盖在节点外沿，吃了指针就会在名字底下丢 hover
    for (const style of ALL_NODE_STYLES) {
      const outer = searchPrims(style.prims, 'label-outer')
      expect([style.id, outer?.pointerEvents]).toEqual([style.id, 'none'])
    }
    const pill = TWIN_2D_SENSOR_PILLS[0]
    expect(pill?.pointerEvents).toBe('none')
    expect(
      pill?.children.every((child) => child.pointerEvents === 'none'),
    ).toBe(true)
  })

  it('§7-16 will-change: transform 逐节点一层 + 舞台 contain: layout style', () => {
    expect(/\.t2-node\s*\{[^}]*will-change:\s*transform/.test(SCSS)).toBe(true)
    expect(/\.t2-stage\s*\{[^}]*contain:\s*layout style/.test(SCSS)).toBe(true)
    // ⚠ 不含 paint：那一档会把贴着边画的描边与外发光裁掉
    expect(SCSS.includes('contain: layout style paint')).toBe(false)
  })

  it('§7-17 一段 prefers-reduced-motion 关掉四个 keyframes，**不关** transition', () => {
    const blocks = SCSS.split('@media (prefers-reduced-motion: reduce)')
    const guard = blocks[1] ?? ''

    expect(blocks.length).toBe(2)
    for (const cls of [
      't2-anim-pulse',
      't2-anim-blink',
      't2-anim-breathe',
      't2-anim-dash',
    ]) {
      expect(guard.includes(cls)).toBe(true)
    }
    expect(guard.includes('animation: none')).toBe(true)
    expect(guard.includes('transition')).toBe(false)
  })
})

describe('§7.3 能量悬浮卡（7 件）', () => {
  it('§7-18 energy-main 三件：inline 基线对齐 gap 4，「输出」「kWh」两个字面量 12px --text-secondary', () => {
    const main = boxOf(SOURCE, 'energy-main')
    const label = txtOf(SOURCE, 'energy-label')
    const unit = txtOf(SOURCE, 'energy-unit')

    expect([main.layout.flow, main.layout.align, main.layout.gap]).toEqual([
      'row',
      'baseline',
      4,
    ])
    expect(label.src).toEqual({ kind: 'lit', text: '输出' })
    expect(unit.src).toEqual({ kind: 'lit', text: 'kWh' })
    expect(label.font).toEqual({
      size: 12,
      letterSpacing: 0,
      color: 'var(--text-secondary)',
    })
    expect(unit.font).toEqual(label.font)
  })

  it('§7-19 energy-pct 能效胶囊：pad 1 6 / border 1px 52% / pill / digit 20px / ls .4 / 底 14% / 发光 8px 26% / 过渡四属性', () => {
    const pill = boxOf(SOURCE, 'energy-pct')
    const value = txtOf(SOURCE, 'efficiency-value')

    expect(pill.layout.pad).toEqual([1, 6, 1, 6])
    expect([pill.border.width, pill.border.color]).toEqual([1, mix(52)])
    expect(pill.radius).toBe('pill')
    const fill = fillAt(pill.fills, 0)
    expect(fill.kind === 'solid' ? fill.color : '').toBe(mix(14))
    expect(shadowTuple(shadowAt(pill.shadows, 0))).toEqual([
      false,
      0,
      0,
      8,
      0,
      mix(26),
    ])
    expect(pill.transition?.props).toEqual([
      'border-color',
      'background',
      'box-shadow',
      'transform',
    ])
    expect(value.font).toEqual({
      family: 'var(--font-digit)',
      size: 20,
      letterSpacing: 0.4,
      color: ACCENT,
    })
  })

  it('§7-20 energy-tip 卡体：abs 50%/-10、z 10、min-width 188、pad 8 10、border 1px 62%、radius-sm、底走 --surface-overlay、blur 8、opacity 0 + scale .96、基点 50% 100%', () => {
    const tip = boxOf(SOURCE, 'energy-tip')

    expect(tip.at).toEqual({
      kind: 'abs',
      left: '50%',
      right: null,
      top: -10,
      bottom: null,
      tx: '-50%',
      ty: 'calc(-100% - 4px)',
    })
    expect([tip.minWidth, tip.z, tip.opacity, tip.scale]).toEqual([
      188, 10, 0, 0.96,
    ])
    // ⚠ 从上沿放大的话卡片会朝节点里长，看着像「弹反了」
    expect(tip.transformOrigin).toBe('50% 100%')
    expect(tip.layout.pad).toEqual([8, 10, 8, 10])
    expect([tip.border.width, tip.border.color]).toEqual([1, mix(62)])
    expect(tip.radius).toBe(4)
    expect(tip.backdropBlur).toBe(8)
    const base = fillAt(tip.fills, 0)
    expect(base.kind === 'solid' ? base.color : '').toBe(
      'var(--surface-overlay)',
    )
  })

  it('§7-21 tip 小箭头：8×8 转 45°，只描右下两条边（开口折线，斜边不描）', () => {
    const arrow = vecOf(SOURCE, 'tip-arrow')

    expect(arrow.size).toEqual({ w: 8, h: 8 })
    expect(arrow.rotate).toBe(45)
    expect(arrow.shape).toEqual({
      kind: 'poly',
      points: [
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      closed: false,
    })
    expect(arrow.fill).toEqual({
      kind: 'color',
      color: 'var(--surface-overlay)',
    })
    expect(strokeAt(arrow.strokes, 0).color).toBe(mix(48))
  })

  it('§7-22 tip 翻转档：交互态里留着 flipped 这一档（运行时按同一条 y < 120 判定并注入）', () => {
    // ⚠ 只守住档位：预置库眼下还没有那条 flipped 变体（`top: calc(100% + 10px)` /
    //   `translate(-50%, 4px)` / 基点 50% 0 / 箭头描边 48%→62%），补上时这条要一起补

    expect([...TWIN_2D_STATES]).toEqual([
      'hover',
      'selected',
      'alarm',
      'active',
      'flipped',
    ])
  })

  it('§7-23 tip 抬头 max-width 220 + 三行 space-between gap 14 + 右侧读数 digit 15px 字晕 6px 38%', () => {
    const title = txtOf(SOURCE, 'tip-title')
    const row = boxOf(SOURCE, 'tip-row-input')
    const value = txtOf(SOURCE, 'tip-input-value')

    expect(title.maxWidth).toBe(220)
    expect(title.font).toEqual({
      size: 12,
      weight: 600,
      color: 'var(--text-title)',
    })
    expect([row.layout.justify, row.layout.align, row.layout.gap]).toEqual([
      'between',
      'baseline',
      14,
    ])
    expect(value.font).toEqual({
      family: 'var(--font-digit)',
      size: 15,
      weight: 400,
      color: ACCENT,
    })
    expect(shadowTuple(shadowAt(value.shadows, 0))).toEqual([
      false,
      0,
      0,
      6,
      0,
      mix(38),
    ])
    expect(boxOf(SOURCE, 'tip-rows').children.length).toBe(3)
  })

  it('§7-24 悬浮卡整体 cursor: help', () => {
    expect(boxOf(SOURCE, 'frame').cursor).toBe('help')
  })
})

describe('§7.4 shape=tank（6 件）', () => {
  it('§7-25 .tnv-tank 胶囊：pill 圆角 / pad 4 14 / **180°** 渐变（≠ box 的 150°）/ 内 16px 12% + 外 9px 26%', () => {
    const frame = boxOf('water-tank', 'frame')

    expect(frame.radius).toBe('pill')
    expect(frame.layout.pad).toEqual([4, 14, 4, 14])
    const base = fillAt(frame.fills, 0)
    expect(base.kind === 'linear' ? base.angle : null).toBe(180)
    expect(frame.shadows.map(shadowTuple)).toEqual([
      [true, 0, 0, 16, 0, mix(12)],
      [false, 0, 0, 9, 0, mix(26)],
    ])
  })

  it('§7-26 .tnv-tank__icon 30×30（比 box 一形的 26 大）', () => {
    expect(asIco(primOf('water-tank', 'icon')).size).toEqual({ w: 30, h: 30 })
  })

  it('§7-27 .tnv-tank__body：col / 两轴居中 / gap 2 / 文字居中', () => {
    const body = boxOf('water-tank', 'body')

    expect([
      body.layout.flow,
      body.layout.align,
      body.layout.justify,
      body.layout.gap,
    ]).toEqual(['col', 'center', 'center', 2])
    expect(txtOf('water-tank', 'reading').align).toBe('center')
  })

  it('§7-28 .tnv-tank__title：18/600 省略号 max-width 100%', () => {
    const title = txtOf('water-tank', 'label-natural')

    expect(title.maxWidth).toBe('100%')
    expect(title.font).toEqual({
      size: 18,
      weight: 600,
      color: 'var(--text-primary)',
    })
    expect([title.nowrap, title.ellipsis]).toEqual([true, true])
  })

  it('§7-29 .tnv-tank__reading：digit 30px / ls .5 / accent / 字晕 3px 70%，内容取「温度 · 液位」派生槽', () => {
    const reading = txtOf('water-tank', 'reading')

    expect(reading.font).toEqual({
      family: 'var(--font-digit)',
      size: 30,
      letterSpacing: 0.5,
      color: ACCENT,
    })
    expect(shadowTuple(shadowAt(reading.shadows, 0))).toEqual([
      false,
      0,
      0,
      3,
      0,
      mix(70),
    ])
    expect(reading.src).toEqual({ kind: 'slot', slot: 'reading' })
  })

  it('§7-30 .tnv-tank__stubs 管接头：abs 24%/24%/-5、高 5、90° 重复渐变（18px 空 + 2px 实）、opacity .45、不吃指针', () => {
    const stubs = boxOf('water-tank', 'stubs')
    const fill = fillAt(stubs.fills, 0)

    expect(stubs.at).toEqual({
      kind: 'abs',
      left: '24%',
      right: '24%',
      top: null,
      bottom: -5,
      tx: '0',
      ty: '0',
    })
    expect(stubs.size.h).toBe(5)
    expect(stubs.opacity).toBe(0.45)
    expect(
      fill.kind === 'repeat'
        ? [fill.angle, fill.gap, fill.width, fill.color]
        : [],
    ).toEqual([90, 18, 2, ACCENT])
  })
})

/** 圆柱那五枚 vec 的描边色，逐值等于参考项目的 `rgba(var(--chart-series-N-rgb), a)` */
const CYL_BODY_INK = 'rgba(123, 213, 255, 0.62)'
const CYL_CAP_INK = 'rgba(123, 213, 255, 0.7)'
const CYL_WARM_INK = 'rgba(255, 92, 122, 0.6)'
const CYL_COOL_INK = 'rgba(47, 233, 255, 0.6)'

describe('§7.5 shape=cylinder（10 件，全 SVG）', () => {
  it('§7-31 .tnv-cyl__svg：五枚 vec 铺满节点盒并两轴各自拉伸（= preserveAspectRatio="none"）', () => {
    for (const id of [
      'frame',
      'cap-left',
      'cap-right',
      'line-warm',
      'line-cool',
    ]) {
      const vec = vecOf('manifold', id)
      expect(vec.stretch).toBe(true)
      expect(vec.coord).toBe('px')
      expect(vec.at).toEqual({ kind: 'fill', inset: [0, 0, 0, 0] })
    }
  })

  it('§7-32 体身那一枚：rect x10 y0 w=W−20 h=H **rx 0**、底 --surface-panel、描边水色 62% / 1.2 / non-scaling', () => {
    const outline = vecOf('manifold', 'frame')
    const pass = strokeAt(outline.strokes, 0)

    expect(outline.shape).toEqual({
      kind: 'rect',
      x: 10,
      y: 0,
      w: 204,
      h: 126,
      rx: 0,
    })
    expect(outline.fill).toEqual({
      kind: 'color',
      color: 'var(--surface-panel)',
    })
    expect([pass.width, pass.color, pass.nonScaling]).toEqual([
      1.2,
      CYL_BODY_INK,
      true,
    ])
    expect(TWIN_2D_PALETTE_RGB.water).toBe('123, 213, 255')
  })

  it('§7-33 端盖与体身不同色：cap 取 --surface-overlay，body 取 --surface-panel', () => {
    const cap = vecOf('manifold', 'cap-left')
    const outline = vecOf('manifold', 'frame')

    // ⚠ 圆柱的立体感全在这一处：抄成同色就变成一个平的矩形加两个椭圆边，而每一项数值都「对」
    expect(cap.fill).toEqual({ kind: 'color', color: 'var(--surface-overlay)' })
    expect(cap.fill).not.toEqual(outline.fill)
  })

  it('§7-34 __cap ×2 的几何与描边：cx 10 / W−10，cy = H/2，rx **固定 10**，ry = 半高，描边水色 70%', () => {
    const left = vecOf('manifold', 'cap-left')
    const right = vecOf('manifold', 'cap-right')

    expect(left.shape).toEqual({
      kind: 'ellipse',
      cx: 10,
      cy: 63,
      rx: 10,
      ry: 63,
    })
    expect(right.shape).toEqual({
      kind: 'ellipse',
      cx: 214,
      cy: 63,
      rx: 10,
      ry: 63,
    })
    expect(strokeAt(left.strokes, 0).color).toBe(CYL_CAP_INK)
    expect(strokeAt(right.strokes, 0).color).toBe(CYL_CAP_INK)
  })

  it('§7-35 __line--warm：y = cy−3，x 14 → W−14，蒸汽色 60%，1.2，圆头，non-scaling', () => {
    const warm = vecOf('manifold', 'line-warm')
    const pass = strokeAt(warm.strokes, 0)

    expect(warm.shape).toEqual({
      kind: 'line',
      x1: 14,
      y1: 60,
      x2: 210,
      y2: 60,
    })
    expect([pass.color, pass.width, pass.cap, pass.nonScaling]).toEqual([
      CYL_WARM_INK,
      1.2,
      'round',
      true,
    ])
  })

  it('§7-36 __line--cool：y = cy+6（与暖管的 −3 **不对称**），太阳能色 60%', () => {
    const cool = vecOf('manifold', 'line-cool')
    const warm = vecOf('manifold', 'line-warm')

    expect(cool.shape).toEqual({
      kind: 'line',
      x1: 14,
      y1: 69,
      x2: 210,
      y2: 69,
    })
    expect(strokeAt(cool.strokes, 0).color).toBe(CYL_COOL_INK)
    const warmY = warm.shape.kind === 'line' ? warm.shape.y1 : 0
    const coolY = cool.shape.kind === 'line' ? cool.shape.y1 : 0
    expect([63 - warmY, coolY - 63]).toEqual([3, 6])
  })

  it('§7-37 cyl 的 selected / alarm：选中线宽 2.5 + 一层 8px 光；报警只换危险色、线宽仍 1.2', () => {
    const selected = strokeAt(
      patchOf('manifold', 'selected', 'frame').strokes ?? [],
      0,
    )
    const alarm = strokeAt(
      patchOf('manifold', 'alarm', 'frame').strokes ?? [],
      0,
    )

    expect([selected.width, selected.color]).toEqual([2.5, CYL_BODY_INK])
    expect(
      shadowTuple(
        shadowAt(variantOf('manifold', 'selected').rootPatch.shadows ?? [], 0),
      ),
    ).toEqual([false, 0, 0, 8, 0, ACCENT])
    expect([alarm.width, alarm.color]).toEqual([1.2, 'var(--state-danger)'])
    expect(
      shadowTuple(
        shadowAt(variantOf('manifold', 'alarm').rootPatch.shadows ?? [], 0),
      ),
    ).toEqual([false, 0, 0, 8, 0, 'var(--state-danger)'])
  })

  it('§7-38 __icon：abs left 7% / top 50% / ty −50%、26×26、z 2', () => {
    const icon = asIco(primOf('manifold', 'icon'))

    expect(icon.at).toEqual({
      kind: 'abs',
      left: '7%',
      right: null,
      top: '50%',
      bottom: null,
      tx: '0',
      ty: '-50%',
    })
    expect(icon.size).toEqual({ w: 26, h: 26 })
    expect(icon.z).toBe(2)
  })

  it('§7-39 __body：abs inset 0 14% 0 24%、col 居中、z 2、不吃指针', () => {
    const body = boxOf('manifold', 'body')

    expect(body.at).toEqual({ kind: 'fill', inset: [0, '14%', 0, '24%'] })
    expect([body.layout.flow, body.layout.align, body.layout.justify]).toEqual([
      'col',
      'center',
      'center',
    ])
    expect([body.z, body.pointerEvents]).toEqual([2, 'none'])
  })

  it('§7-40 __title 的字晕取**背景色** --t2-fill-b（抄成 accent 会让标题在深色底上发绿光）；__reading digit 30px 且无字距', () => {
    const title = txtOf('manifold', 'label-natural')
    const reading = txtOf('manifold', 'reading')

    expect(shadowTuple(shadowAt(title.shadows, 0))).toEqual([
      false,
      0,
      0,
      4,
      0,
      'var(--t2-fill-b)',
    ])
    // ⚠ 罐形那一处是 ls .5，圆柱这一处没有——参考项目逐值不同
    expect(reading.font).toEqual({
      family: 'var(--font-digit)',
      size: 30,
      color: ACCENT,
    })
  })
})

describe('§7.6 shape=square / text（5 件）', () => {
  it('§7-41 .tnv-square 外壳 + __tile：shell 只居中，frame 铺满 + 1.5 描边 + radius-md + 150° 渐变 + 内 14px 14% / 外 8px 24%，图标 50%/50%', () => {
    const shell = boxOf('heat-exchanger', 'shell')
    const tile = boxOf('heat-exchanger', 'frame')
    const glyph = asIco(primOf('heat-exchanger', 'glyph'))

    expect(shell.layout.flow).toBe('none')
    expect(tile.at).toEqual({ kind: 'fill', inset: [0, 0, 0, 0] })
    expect([tile.border.width, tile.radius]).toEqual([1.5, 8])
    const base = fillAt(tile.fills, 0)
    expect(base.kind === 'linear' ? base.angle : null).toBe(150)
    expect(tile.shadows.map(shadowTuple)).toEqual([
      [true, 0, 0, 14, 0, mix(14)],
      [false, 0, 0, 8, 0, mix(24)],
    ])
    // Len 支持百分比正是为这一件
    expect(glyph.size).toEqual({ w: '50%', h: '50%' })
  })

  it('§7-42 .tnv-square__label：abs 50% / bottom −2 / translate(−50%, 100%)、**17px**（= 18−1）/ 600 / 字晕 4px 50%', () => {
    const label = txtOf('heat-exchanger', 'label-natural')

    expect(label.at).toEqual({
      kind: 'abs',
      left: '50%',
      right: null,
      top: null,
      bottom: -2,
      tx: '-50%',
      ty: '100%',
    })
    expect(label.font).toEqual({
      size: 17,
      weight: 600,
      color: 'var(--text-primary)',
    })
    expect(shadowTuple(shadowAt(label.shadows, 0))).toEqual([
      false,
      0,
      0,
      4,
      0,
      mix(50),
    ])
  })

  it('§7-43 .tnv-text__bar：3px × 1em、实心 accent、6px 同色发光、**无圆角**', () => {
    const bar = boxOf('label', 'bar')
    const fill = fillAt(bar.fills, 0)

    expect(bar.size).toEqual({ w: 3, h: '1em' })
    expect(bar.radius).toBe(0)
    expect(fill.kind === 'solid' ? fill.color : '').toBe(ACCENT)
    expect(shadowTuple(shadowAt(bar.shadows, 0))).toEqual([
      false,
      0,
      0,
      6,
      0,
      ACCENT,
    ])
  })

  it('§7-44 .tnv-text__label：18/600 nowrap 字晕 5px 45%', () => {
    const label = txtOf('label', 'label-natural')

    expect(label.font).toEqual({
      size: 18,
      weight: 600,
      color: 'var(--text-primary)',
    })
    expect(label.nowrap).toBe(true)
    expect(shadowTuple(shadowAt(label.shadows, 0))).toEqual([
      false,
      0,
      0,
      5,
      0,
      mix(45),
    ])
  })

  it('§7-45 shape 兜底：样式 id 找不到 → 落 __fallback **并进诊断**（参考项目那边是纯静默）', () => {
    const issues = collectTwin2dIssues({
      canvas: {},
      styles: [],
      nodes: [{ id: 'n1', styleId: '找不到的样式' }],
      edges: [],
      marks: [],
    })
    const dangling = issues.filter((issue) => issue.code === 'dangling-style')

    expect(dangling.length).toBe(1)
    expect(dangling[0]?.level).toBe('error')
    expect(dangling[0]?.message.includes('__fallback')).toBe(true)
  })
})

describe('§7.7 根容器、角标、状态点、显示名（11 件）', () => {
  it('§7-46 .tnv 根：字体族改走 var(--font-sans)，六个局部变量由 injectVars 注入', () => {
    const node = nodeOf({ id: 'n1', styleId: SOURCE })
    const vars = injectVars(node, styleOf(SOURCE), '', 'online')

    expect(
      /\.t2-node\s*\{[^}]*font-family:\s*var\(--font-sans\)/.test(SCSS),
    ).toBe(true)
    expect(Object.keys(vars).sort()).toEqual([
      '--t2-accent',
      '--t2-anim-dur',
      '--t2-badge',
      '--t2-fill-a',
      '--t2-fill-b',
      '--t2-status',
    ])
  })

  it('§7-47 强调色三级兜底链：节点 → 样式 → --accent-primary（参考项目节点侧无二级兜底，这里统一成有）', () => {
    expect(resolveAccent('', '')).toBe('var(--accent-primary)')
    expect(resolveAccent('', 'var(--chart-series-1)')).toBe(
      'var(--chart-series-1, var(--accent-primary))',
    )
    expect(resolveAccent('--node-c', 'var(--style-c)')).toBe(
      'var(--node-c, var(--style-c, var(--accent-primary)))',
    )
    // ⚠ 字面色不会解析失败，塞进 var() 头位反而让整条声明非法，故链在它那里结束
    expect(resolveAccent('#62ff8a', 'var(--style-c)')).toBe('#62ff8a')
  })

  it('§7-48 is-selected：一圈 2px 实边 + 16px 45% 外发光，四形一律落在有圆角的那块可见面上', () => {
    // ⚠ 参考项目那条规则挂的是 `.tnv-box` / `.tnv-tank` / `.tnv-square__tile`，三者
    //   各有自己的圆角；节点根 `.tnv` 与本模型的 `.t2-node` 都**没有 border-radius**。
    //   把 spread 2 的实边挪到根上，取值一条都不差，画出来却是圆角盒**外**的一个直角
    //   框，且没有一处会报错——所以这里连「根上没有阴影」一起守
    const want = [
      [false, 0, 0, 0, 2, ACCENT],
      [false, 0, 0, 16, 0, mix(45)],
    ]
    const faces: readonly (readonly [string, string, Twin2dRadius])[] = [
      [SOURCE, 'frame', 8],
      ['water-tank', 'frame', 'pill'],
      ['heating-terminal', 'frame', 8],
      ['heat-exchanger', 'frame', 8],
    ]

    for (const [styleId, primId, radius] of faces) {
      const face = patchOf(styleId, 'selected', primId)
      expect((face.shadows ?? []).map(shadowTuple)).toEqual(want)
      expect(variantOf(styleId, 'selected').rootPatch.shadows).toBeUndefined()
      expect(boxOf(styleId, primId).radius).toEqual(radius)
    }
  })

  it('§7-49 is-alarm：描边转 --state-danger + 1s 呼吸；新模型里没有 !important', () => {
    const frame = patchOf(SOURCE, 'alarm', 'frame')

    expect(variantOf(SOURCE, 'alarm').when).toEqual({
      kind: 'status',
      in: ['alarm'],
    })
    expect(frame.border?.color).toBe('var(--state-danger)')
    expect(frame.anim).toEqual({ kind: 'breathe', durationMs: 1000 })
    // ⚠ 只看**数据**不看源码正文：注释里正写着「新模型里没有 !important」，
    //   扫正文会被自己的注释骗过去
    expect(JSON.stringify(ALL_NODE_STYLES).includes('!important')).toBe(false)
  })

  it('§7-50 .tnv-badge 盒：abs tl / translate(-40%,-40%) / min-w 18 h 18 / pad 0 3 / pill / 1.5px 边 / 7px 75% 发光，取色 = node.badgeColor || accent', () => {
    const style = styleOf(SOURCE)
    const plain = injectVars(
      nodeOf({ id: 'n1', styleId: SOURCE }),
      style,
      '',
      'online',
    )
    const painted = injectVars(
      nodeOf({ id: 'n1', styleId: SOURCE, badgeColor: 'var(--state-warning)' }),
      style,
      '',
      'online',
    )

    expect(plain['--t2-badge']).toBe(plain['--t2-accent'])
    expect(painted['--t2-badge']).toBe(
      `var(--state-warning, ${plain['--t2-accent'] ?? ''})`,
    )

    const badge = boxOf(SOURCE, 'badge')
    const fill = fillAt(badge.fills, 0)

    expect(badge.at).toEqual({
      kind: 'abs',
      left: 0,
      right: null,
      top: 0,
      bottom: null,
      tx: '-40%',
      ty: '-40%',
    })
    expect([badge.minWidth, badge.size]).toEqual([18, { w: 'auto', h: 18 }])
    expect(badge.layout.pad).toEqual([0, 3, 0, 3])
    expect([badge.radius, badge.z]).toEqual(['pill', 5])
    expect(fill.kind === 'solid' ? fill.color : '').toBe(BADGE_VAR)
    expect([badge.border.width, badge.border.color]).toEqual([
      1.5,
      `color-mix(in srgb, var(--text-primary) 35%, ${BADGE_VAR})`,
    ])
    expect(shadowTuple(shadowAt(badge.shadows, 0))).toEqual([
      false,
      0,
      0,
      7,
      0,
      `color-mix(in srgb, ${BADGE_VAR} 75%, transparent)`,
    ])
    // ⚠ 显示条件读的是节点字段而不是 tag：合进自由 tag 表就等于让用户的同名 tag
    //   能把别人的角标点亮，而那既不像配置生效也不像出错
    expect(badge.when).toEqual({
      kind: 'field',
      field: 'badge',
      test: 'present',
      in: [],
    })
    for (const style of ALL_NODE_STYLES) {
      expect([style.id, searchPrims(style.prims, 'badge') !== null]).toEqual([
        style.id,
        true,
      ])
    }
  })

  it('§7-51 .tnv-badge 字：15 / 700 / --text-primary / line-height 1 / 字体族走 --font-display，父盒 none + 居中', () => {
    const text = txtOf(SOURCE, 'badge-text')
    const parent = boxOf(SOURCE, 'badge')

    expect(text.src).toEqual({ kind: 'badge' })
    expect(text.font).toEqual({
      family: 'var(--font-display)',
      size: 15,
      weight: 700,
      color: 'var(--text-primary)',
    })
    // ⚠ 少了这一格角标会被行高撑成椭圆：18px 高的药丸里放 15px 的字，
    //   缺省行高（约 1.2）算出来就顶到 18px 再加上下留白
    expect(text.lineHeight).toBe(1)
    expect(
      paintText(text, {
        node: nodeOf({ id: 'n1', styleId: SOURCE }),
        boxW: 18,
        boxH: 18,
        idPrefix: 'p',
      }).style['line-height'],
    ).toBe('1')
    expect([
      parent.layout.flow,
      parent.layout.align,
      parent.layout.justify,
    ]).toEqual(['none', 'center', 'center'])
  })

  it('§7-52 badgeShape 三档：参考项目那两档（circle-number / circle-letter）都映射到 round，square / diamond 是新增', () => {
    expect([...TWIN_2D_BADGE_SHAPES]).toEqual(['round', 'square', 'diamond'])
    expect(nodeOf({ id: 'n1', styleId: SOURCE }).badgeShape).toBe('round')
    expect(
      nodeOf({ id: 'n1', styleId: SOURCE, badgeShape: 'circle-number' })
        .badgeShape,
    ).toBe('round')
  })

  it('§7-53 .tnv-dot 状态点：abs r5 b5、7×7、圆、取 --t2-status、6px 同色发光、z 5，报警时脉冲', () => {
    const dot = boxOf(SOURCE, 'status-dot')
    const fill = fillAt(dot.fills, 0)

    expect(dot.at).toEqual({
      kind: 'abs',
      left: null,
      right: 5,
      top: null,
      bottom: 5,
      tx: '0',
      ty: '0',
    })
    expect(dot.size).toEqual({ w: 7, h: 7 })
    expect([dot.radius, dot.z]).toEqual(['pill', 5])
    expect(fill.kind === 'solid' ? fill.color : '').toBe('var(--t2-status)')
    expect(shadowTuple(shadowAt(dot.shadows, 0))).toEqual([
      false,
      0,
      0,
      6,
      0,
      'var(--t2-status)',
    ])
    expect(patchOf(SOURCE, 'alarm', 'status-dot').anim).toEqual({
      kind: 'pulse',
      durationMs: 1000,
    })
  })

  it('§7-54 status 五档配色：offline 走 **--state-idle**（不是 --state-offline），hidden 整点不渲染', () => {
    expect(statusColor('online')).toBe('var(--state-success)')
    expect(statusColor('offline')).toBe('var(--state-idle)')
    expect(statusColor('warning')).toBe('var(--state-warning)')
    expect(statusColor('alarm')).toBe('var(--state-danger)')
    expect(statusColor('hidden')).toBe(null)
  })

  it('§7-55 status 缺省两种行为落成样式上的 defaultStatus：装饰类 hidden、设备类 online；category 一处渲染判断都不参与', () => {
    expect(styleOf('label').defaultStatus).toBe('hidden')
    for (const style of ALL_NODE_STYLES.filter(
      (one) => one.category !== 'label',
    )) {
      expect(style.defaultStatus).toBe('online')
    }
    for (const [name, text] of renderAndPaintSources()) {
      expect([name, text.includes('.category')]).toEqual([name, false])
    }
  })

  it('§7-56 labelPos 六档：bottom 走各形状内部的自然名位，另四档走外置那一枚，hidden 两枚都不画', () => {
    expect([...TWIN_2D_LABEL_POSITIONS]).toEqual([
      'bottom',
      'top',
      'left',
      'right',
      'inside',
      'hidden',
    ])
    expect(nodeOf({ id: 'n1', styleId: SOURCE }).labelPos).toBe('bottom')
    for (const style of ALL_NODE_STYLES) {
      const natural = searchPrims(style.prims, 'label-natural')
      const outer = searchPrims(style.prims, 'label-outer')

      expect([style.id, natural?.when, outer?.when]).toEqual([
        style.id,
        { kind: 'field', field: 'labelPos', test: 'in', in: ['bottom'] },
        {
          kind: 'field',
          field: 'labelPos',
          test: 'in',
          in: ['top', 'left', 'right', 'inside'],
        },
      ])
    }
    // hidden 那一档两个条件都不成立 = 两枚都不画
    for (const pos of ['bottom', 'top', 'left', 'right', 'inside', 'hidden']) {
      const shown = ['label-natural', 'label-outer'].filter((id) =>
        labelShownAt(id, pos),
      )
      expect([pos, shown]).toEqual([
        pos,
        pos === 'hidden'
          ? []
          : [pos === 'bottom' ? 'label-natural' : 'label-outer'],
      ])
    }
  })

  it('§7-56b 外置显示名逐值：abs 四档 / 上限 160 而 inside 一档 92% / 18-600 / 单行省略 / 4px 50% 字晕 / z 4', () => {
    const outer = txtOf(SOURCE, 'label-outer')

    expect(outer.at).toEqual(NAME_AT_TOP)
    expect([outer.maxWidth, outer.z]).toEqual([160, 4])
    expect(outer.font).toEqual({
      size: 18,
      weight: 600,
      color: 'var(--text-primary)',
    })
    expect([outer.nowrap, outer.ellipsis]).toEqual([true, true])
    expect(shadowTuple(shadowAt(outer.shadows, 0))).toEqual([
      false,
      0,
      0,
      4,
      0,
      mix(50),
    ])
    expect(labelPatchAt('left')).toEqual({
      at: {
        kind: 'abs',
        left: null,
        right: '100%',
        top: '50%',
        bottom: null,
        tx: '-6px',
        ty: '-50%',
      },
      align: 'end',
    })
    expect(labelPatchAt('right')).toEqual({
      at: {
        kind: 'abs',
        left: '100%',
        right: null,
        top: '50%',
        bottom: null,
        tx: '6px',
        ty: '-50%',
      },
      align: 'start',
    })
    // ⚠ inside 那一档的上限是 92% 不是 160px：贴在节点正中的名字要跟着盒宽收
    expect(labelPatchAt('inside')).toEqual({
      at: {
        kind: 'abs',
        left: '50%',
        right: null,
        top: '50%',
        bottom: null,
        tx: '-50%',
        ty: '-50%',
      },
      align: 'center',
      maxWidth: '92%',
    })
  })
})

describe('§7.8 传感器药丸（4 件）', () => {
  it('§7-57 .topo-sensor 药丸：基准 16px、gap .28em、pad .12em .5em、pill、1px 主色描边、底走 --t2-fill-a、6px 55% 发光', () => {
    const pill = TWIN_2D_SENSOR_PILLS[0]
    if (pill === undefined) throw new Error('没有预置药丸')
    const fill = fillAt(pill.fills, 0)

    expect([pill.layout.gap, pill.layout.pad]).toEqual([
      4.48,
      [1.92, 8, 1.92, 8],
    ])
    expect(pill.layout.align).toBe('baseline')
    expect(pill.radius).toBe('pill')
    expect([pill.border.width, pill.border.color]).toEqual([
      1,
      TWIN_2D_PALETTE.wasteHeat,
    ])
    expect(fill.kind === 'solid' ? fill.color : '').toBe(
      'var(--t2-fill-a, var(--surface-panel))',
    )
    expect(shadowTuple(shadowAt(pill.shadows, 0))).toEqual([
      false,
      0,
      0,
      6,
      0,
      `color-mix(in srgb, ${TWIN_2D_PALETTE.wasteHeat} 55%, transparent)`,
    ])
  })

  it('§7-58 __kind / __val / __unit：700 + ls .04em、digit + 700 + 5px 自身色字晕、.78em + opacity .82，且没有单位时整片不渲染', () => {
    const def = TWIN_2D_SENSOR_DEFS[0]
    if (def === undefined) throw new Error('没有预置传感器')
    const pill = TWIN_2D_SENSOR_PILLS[0]
    const [tag, value, unit] = (pill?.children ?? []).map(asTxt)
    if (tag === undefined || value === undefined || unit === undefined) {
      throw new Error('药丸不是三片')
    }

    expect([tag.font.weight, tag.font.letterSpacing, tag.font.size]).toEqual([
      700, 0.64, 16,
    ])
    expect(tag.src).toEqual({ kind: 'lit', text: 'TT' })
    expect([value.font.family, value.font.weight]).toEqual([
      'var(--font-digit)',
      700,
    ])
    expect(shadowTuple(shadowAt(value.shadows, 0))).toEqual([
      false,
      0,
      0,
      5,
      0,
      'currentColor',
    ])
    expect([unit.font.size, unit.opacity, unit.hidden]).toEqual([
      12.48,
      0.82,
      false,
    ])
    const noUnit = twin2dSensorPill(
      { ...def, unit: '' },
      TWIN_2D_SENSOR_DEFAULT_AT,
      'x',
    )
    expect(asTxt(noUnit.children[2] ?? noUnit).hidden).toBe(true)
  })

  it('§7-59 perimT 落点：left/top 取周长点占盒的百分比，transform 用法线推出半个自身尺寸，GAP 恒 0', () => {
    const top = perimCss(
      { kind: 'perim', t: 0.125, gap: 0, dx: 0, dy: 0 },
      200,
      100,
    )

    expect(top['left']).toBe('50%')
    expect(top['top']).toBe('0%')
    expect(top['transform']).toBe(
      'translate(calc(-50% + 0px), calc(-100% + 0px))',
    )
    expect(top['position']).toBe('absolute')
  })

  it('§7-60 anchor 九档：一张固定的 tx/ty 百分比表，逐档照抄；缺省落点是上边中点外侧', () => {
    const table: readonly (readonly [string, string, string])[] = [
      ['t', '-50%', '-115%'],
      ['b', '-50%', '115%'],
      ['l', '-110%', '-50%'],
      ['r', '110%', '-50%'],
      ['tl', '-20%', '-115%'],
      ['tr', '20%', '-115%'],
      ['bl', '-20%', '115%'],
      ['br', '20%', '115%'],
      ['c', '-50%', '-50%'],
    ]

    expect([...TWIN_2D_ANCHORS]).toEqual(table.map((row) => row[0]))
    for (const [anchor, tx, ty] of table) {
      const style = anchor9Css(anchorOf(anchor), 0, 0)
      expect([anchor, style['transform']]).toEqual([
        anchor,
        `translate(calc(${tx} + 0px), calc(${ty} + 0px))`,
      ])
    }
    expect(TWIN_2D_SENSOR_DEFAULT_AT).toEqual({
      kind: 'anchor',
      anchor: 't',
      dx: 0,
      dy: 0,
    })
  })
})

describe('§7.9 连线（10 件）', () => {
  it('§7-61 连线颜色：5 种预置的主色逐值同 --chart-series-1..5，取色走同一条兜底链', () => {
    expect(
      TWIN_2D_EDGE_PRESETS.map((style) => [style.id, style.name, style.accent]),
    ).toEqual([
      ['waste-heat', '余热', TWIN_2D_PALETTE.wasteHeat],
      ['steam', '蒸汽', TWIN_2D_PALETTE.steam],
      ['air', '空气能', TWIN_2D_PALETTE.airEnergy],
      ['solar', '太阳能', TWIN_2D_PALETTE.solar],
      ['water', '水流', TWIN_2D_PALETTE.water],
    ])
    expect(resolveAccent('', TWIN_2D_PALETTE.water)).toBe(TWIN_2D_PALETTE.water)
  })

  it('§7-62 .topo-edge 芯线：宽 2 / dash 10 10 / 圆头圆角 / non-scaling', () => {
    const core = lastStroke(0)

    expect([core.width, core.cap, core.join, core.nonScaling]).toEqual([
      2,
      'round',
      'round',
      true,
    ])
    expect([...core.dash]).toEqual([10, 10])
    expect(core.color).toBe('currentColor')
  })

  it('§7-63 四种路径：waypoints 非空**优先于** route；orthogonal ≡ step 同一实现；预置给 auto 不钉死一档', () => {
    const base = {
      start: { x: 0, y: 0 },
      end: { x: 200, y: 120 },
      startSide: 'right' as const,
      endSide: 'left' as const,
      radius: 8,
      labelAt: 0.5,
      reversed: false,
    }

    expect([...TWIN_2D_ROUTE_KINDS]).toEqual([
      'orthogonal',
      'step',
      'bezier',
      'straight',
    ])
    expect(TWIN_2D_EDGE_PRESETS.every((style) => style.route === 'auto')).toBe(
      true,
    )
    expect(edgePath({ ...base, waypoints: [], route: 'orthogonal' })).toEqual(
      edgePath({ ...base, waypoints: [], route: 'step' }),
    )
    // 拐点非空时 straight 也走折线：waypoints 赢
    const withWp = edgePath({
      ...base,
      waypoints: [{ x: 100, y: 0 }],
      route: 'straight',
    })
    expect(withWp.points.length).toBe(3)
  })

  it('§7-64 圆角折线 r=8：rr<0.5 与近共线（点积 >0.999）两条退化保护各出直角，坐标一位小数', () => {
    const arc = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      8,
    )
    const nearStraight = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 1 },
      ],
      8,
    )
    const tooShort = roundCorners(
      [
        { x: 0, y: 0 },
        { x: 0.4, y: 0 },
        { x: 0.4, y: 40 },
      ],
      8,
    )

    expect(arc.includes('A8,8')).toBe(true)
    expect(nearStraight.includes('A')).toBe(false)
    expect(tooShort.includes('A')).toBe(false)
    expect(TWIN_2D_DEFAULT_CORNER_RADIUS).toBe(8)
  })

  it('§7-65 箭头：size 10 / 展开 ±0.42 rad / 实心 / opacity 0.82，起点一端不画标记', () => {
    const style = edgeStyleOf('water')

    expect(style.endMarker).toEqual({
      kind: 'arrow',
      size: 10,
      spread: 0.42,
      filled: true,
      opacity: 0.82,
    })
    expect(style.startMarker).toEqual({ kind: 'none' })
    const view = edgeViews(false, 1)[0]
    expect(view?.markers.length).toBe(1)
    expect(view?.markers[0]?.attrs['opacity']).toBe('0.82')
  })

  it('§7-66 方向反转：端点互换 + side 互换 + **waypoints 整体 reverse** 三件同时做', () => {
    const wp = [
      { x: 60, y: 0 },
      { x: 60, y: 90 },
    ]
    const forward = {
      start: { x: 0, y: 0 },
      end: { x: 200, y: 120 },
      startSide: 'right' as const,
      endSide: 'left' as const,
      waypoints: wp,
      route: 'orthogonal' as const,
      radius: 8,
      labelAt: 0.5,
      reversed: false,
    }
    const flipped = edgePath({ ...forward, reversed: true })

    expect(flipped).toEqual(
      edgePath({
        ...forward,
        start: forward.end,
        end: forward.start,
        startSide: 'left',
        endSide: 'right',
        waypoints: [...wp].reverse(),
      }),
    )
    // ⚠ 只换端点不反序拐点，带拐点的路径会自己交叉——而它看起来像「拐点算错了」
    expect(flipped.points[1]).toEqual({ x: 60, y: 90 })
  })

  it('§7-67 流动：总闸 → flow.enabled → 时长 = 800ms ÷ speed，dashoffset 终点由 dash 求和算出（不写死 −20）', () => {
    const style = edgeStyleOf('water')

    expect(style.flow).toEqual({
      enabled: true,
      dash: [10, 10],
      durationMs: 800,
    })
    expect(edgeViews(false, 1)[0]?.flow).toBe(null)
    expect(edgeViews(true, 1)[0]?.flow).toEqual({
      durationMs: 800,
      dashEnd: -20,
    })
    expect(edgeViews(true, 2)[0]?.flow).toEqual({
      durationMs: 400,
      dashEnd: -20,
    })
    // 流动只加在最上面那一遍：两遍一起动会看成一条粗虚线在爬
    expect(edgeViews(true, 1)[0]?.strokes.map((pass) => pass.flowing)).toEqual([
      false,
      true,
    ])
  })

  it('§7-68 非活跃边：照常渲染，只压整组 opacity .5 并拉直虚线；编辑器与运行态共用同一份', () => {
    const style = edgeStyleOf('water')
    const view = edgeViews(true, 1, {
      e1: { active: false, reversed: false, label: '' },
    })[0]

    expect(style.inactive).toEqual({ opacity: 0.5, dashOff: true, color: '' })
    expect(view?.opacity).toBe(0.5)
    expect(view?.flow).toBe(null)
    expect(view?.strokes[1]?.attrs['stroke-dasharray']).toBe(undefined)
  })

  it('§7-69 多遍描边（参考项目没有）：宽底 6px 22% + 窄芯 2px，双线靠两遍叠出来', () => {
    const style = edgeStyleOf('water')
    const base = strokeAt(style.strokes, 0)

    expect(style.strokes.length).toBe(2)
    expect([base.width, base.color]).toEqual([
      6,
      'color-mix(in srgb, currentColor 22%, transparent)',
    ])
    expect([...base.dash]).toEqual([])
  })

  it('§7-70 连线标签（参考项目没有）：digit 12px/600，底板 pill + pad 2 6 + 无描边，沿弧长 labelAt 摆', () => {
    const label = edgeStyleOf('water').label
    const box = label.box
    if (box === null) throw new Error('预置连线标签没有底板')

    expect(label.font).toEqual({
      family: 'var(--font-digit)',
      size: 12,
      weight: 600,
    })
    expect(box.radius).toBe('pill')
    expect(box.pad).toEqual([2, 6, 2, 6])
    expect(box.border.width).toBe(0)
    expect(box.fill).toBe(
      'color-mix(in srgb, var(--surface-base) 80%, transparent)',
    )
    const view = edgeViews(false, 1, {
      e1: { active: true, reversed: false, label: '流量' },
    })[0]
    expect(view?.label?.text).toBe('流量')
  })
})

describe('§7.10 标注、舞台、底板（8 件）', () => {
  it('§7-71 标注缺省：strokeWidth 2 / opacity 1 / 描边填充留空交给渲染层 / zOrder below / **non-scaling 缺省关**（与参考项目一致）', () => {
    const mark = normalizeMark({ id: 'm1', kind: 'rect' })

    expect(mark?.strokeWidth).toBe(2)
    expect(mark?.opacity).toBe(1)
    expect([mark?.stroke, mark?.fill]).toEqual(['', ''])
    expect(mark?.zOrder).toBe('below')
    expect(mark?.nonScalingStroke).toBe(false)
  })

  it('§7-72 标注标签排版：描边字走 paint-order: stroke（少了它描边盖在字上，字变虚）', () => {
    const outline = 'color-mix(in srgb, var(--surface-base) 80%, transparent)'
    const prim = normalizePrim(
      { id: 't', kind: 'txt', outline: { width: 3, color: outline } },
      0,
    )
    if (prim === null) throw new Error('归一化失败')
    const out = paintText(asTxt(prim), {
      node: nodeOf({ id: 'n1', styleId: SOURCE }),
      boxW: 200,
      boxH: 100,
      idPrefix: 'p',
    })

    expect(out.style['paint-order']).toBe('stroke')
    expect(out.style['-webkit-text-stroke-width']).toBe('3px')
    expect(out.style['-webkit-text-stroke-color']).toBe(outline)
  })

  it('§7-74 标注 zOrder 在编辑器里也生效：舞台按 below / above 分两层，运行态与编辑器同一个组件', () => {
    const marks = [
      { id: 'm-below', kind: 'rect', x: 0, y: 0 },
      { id: 'm-above', kind: 'rect', x: 0, y: 0, zOrder: 'above' },
    ]
    const wrapper = mountStage({ marks }, { w: 800, h: 400 }, true)

    expect(wrapper.get('[data-test="below"]').text()).toBe('m-below')
    expect(wrapper.get('[data-test="above"]').text()).toBe('m-above')
  })

  it('§7-75 舞台等比缩放：fitPadding 缺省 4（= 参考项目那 4% 安全留白），量不出容器时只藏起来、**不产 transform**', () => {
    expect([
      TWIN_2D_MIN_FIT_PADDING,
      TWIN_2D_DEFAULT_FIT_PADDING,
      TWIN_2D_MAX_FIT_PADDING,
    ]).toEqual([0, 4, 20])
    const fitted = viewportStyleOf(mountStage({}, { w: 400, h: 200 }))
    const blind = viewportStyleOf(mountStage({}, { w: 0, h: 0 }))

    expect(fitted.includes('scale(0.96, 0.96)')).toBe(true)
    // ⚠ 少了这条保护首帧会写出 translate(NaN, NaN)，而画面只是空白
    expect(blind.includes('visibility: hidden')).toBe(true)
    expect(blind.includes('translate')).toBe(false)
    expect(blind.includes('NaN')).toBe(false)
  })

  it('§7-76 模块底板斜织：45° 与 −45° 两层、缺省 26px 间距 / 1px 线宽，图案色照抄参考项目那条只活在兜底位的表达式', () => {
    expect([
      TWIN_2D_DEFAULT_PATTERN_GAP,
      TWIN_2D_DEFAULT_PATTERN_WIDTH,
    ]).toEqual([26, 1])
    const style = mountStage(
      { canvas: { pattern: 'weave' } },
      { w: 800, h: 400 },
    )
      .get('[data-layer="pattern"]')
      .attributes('style')

    expect(style?.includes('45deg')).toBe(true)
    expect(style?.includes('-45deg')).toBe(true)
    expect(style?.includes('26px')).toBe(true)
    expect(
      style?.includes(
        'color-mix(in srgb, var(--accent-primary) 5%, transparent)',
      ),
    ).toBe(true)
  })

  it('§7-77 空态：一行字，文案里不出现旧名', () => {
    const wrapper = mountStage({ nodes: [], marks: [] }, { w: 800, h: 400 })
    const empty = wrapper.get('.t2-stage__empty')

    expect(empty.text()).toBe('这张 2D 孪生还没有画任何节点')
    expect(empty.text().includes('拓扑')).toBe(false)
  })

  it('§7-78 可点外观不设 clickable 开关：整个包里一处 clickable 都没有', () => {
    for (const [name, text] of allSources()) {
      expect([name, text.includes('clickable')]).toEqual([name, false])
    }
  })
})

describe('§7.11 内置图标 sprite（11 件）', () => {
  it('§7-79 ico-src-waste-heat：viewBox 0 0 240 150、渐变 recoveryFill(17495D→0C2A38)、六色写死、ico.color 对它无效', () => {
    const symbol = symbolOf('ico-src-waste-heat')

    expect(symbol.viewBox).toBe('0 0 240 150')
    expect(symbol.gradients).toEqual(['recoveryFill'])
    expect(symbol.stops).toEqual(['#17495D', '#0C2A38'])
    expect(symbol.colors).toEqual([
      '#0C2A38',
      '#17495D',
      '#2FE9FF',
      '#62FF8A',
      '#FF5C7A',
      '#FF9B54',
    ])
    expect(isFixedColor('ico-src-waste-heat')).toBe(true)
    expect(subtypeSprite('waste-heat')).toBe('ico-src-waste-heat')
  })

  it('§7-80 ico-src-steam：viewBox 0 0 220 180、渐变 hxFill(15425F→0B2738)、六色写死', () => {
    const symbol = symbolOf('ico-src-steam')

    expect(symbol.viewBox).toBe('0 0 220 180')
    expect(symbol.gradients).toEqual(['hxFill'])
    expect(symbol.stops).toEqual(['#15425F', '#0B2738'])
    expect(symbol.colors).toEqual([
      '#0B2738',
      '#15425F',
      '#2FE9FF',
      '#62DCFF',
      '#7BD5FF',
      '#FF9B54',
    ])
    expect(isFixedColor('ico-src-steam')).toBe(true)
    expect(subtypeSprite('steam')).toBe('ico-src-steam')
  })

  it('§7-81 ico-src-air-source：viewBox 0 0 148 148、渐变 pumpFill(16445F→0B2738)、**五**色写死', () => {
    const symbol = symbolOf('ico-src-air-source')

    expect(symbol.viewBox).toBe('0 0 148 148')
    expect(symbol.gradients).toEqual(['pumpFill'])
    expect(symbol.stops).toEqual(['#16445F', '#0B2738'])
    expect(symbol.colors).toEqual([
      '#0B2738',
      '#16445F',
      '#62DCFF',
      '#7BD5FF',
      '#D9F7FF',
    ])
    expect(isFixedColor('ico-src-air-source')).toBe(true)
    expect(subtypeSprite('air-energy')).toBe('ico-src-air-source')
  })

  it('§7-82 ico-src-solar：viewBox 0 0 240 150、渐变 solarFill(1B4A62→0B2738)、六色写死', () => {
    const symbol = symbolOf('ico-src-solar')

    expect(symbol.viewBox).toBe('0 0 240 150')
    expect(symbol.gradients).toEqual(['solarFill'])
    expect(symbol.stops).toEqual(['#1B4A62', '#0B2738'])
    expect(symbol.colors).toEqual([
      '#0B2738',
      '#1B4A62',
      '#2FE9FF',
      '#62DCFF',
      '#7BD5FF',
      '#FFE65C',
    ])
    expect(isFixedColor('ico-src-solar')).toBe(true)
    expect(subtypeSprite('solar')).toBe('ico-src-solar')
  })

  it('§7-83 ico-vsl-tank：48 见方、5 处 currentColor、ico.color 生效；水箱用它', () => {
    const symbol = symbolOf('ico-vsl-tank')

    expect([symbol.viewBox, symbol.currentColor, symbol.colors.length]).toEqual(
      ['0 0 48 48', 5, 0],
    )
    expect(isFixedColor('ico-vsl-tank')).toBe(false)
    expect(asIco(primOf('water-tank', 'icon')).src).toEqual({
      kind: 'sprite',
      id: 'ico-vsl-tank',
    })
  })

  it('§7-84 ico-vsl-manifold：48 见方、10 处 currentColor；分集水器用它', () => {
    const symbol = symbolOf('ico-vsl-manifold')

    expect([symbol.viewBox, symbol.currentColor]).toEqual(['0 0 48 48', 10])
    expect(isFixedColor('ico-vsl-manifold')).toBe(false)
    expect(asIco(primOf('manifold', 'icon')).src).toEqual({
      kind: 'sprite',
      id: 'ico-vsl-manifold',
    })
  })

  it('§7-85 ico-hx：48 见方、8 处 currentColor；板式换热器用它', () => {
    const symbol = symbolOf('ico-hx')

    expect([symbol.viewBox, symbol.currentColor]).toEqual(['0 0 48 48', 8])
    expect(asIco(primOf('heat-exchanger', 'glyph')).src).toEqual({
      kind: 'sprite',
      id: 'ico-hx',
    })
  })

  it('§7-86 ico-term-shower：48 见方、7 处 currentColor；洗浴末端与 shower 子类用它', () => {
    const symbol = symbolOf('ico-term-shower')

    expect([symbol.viewBox, symbol.currentColor]).toEqual(['0 0 48 48', 7])
    expect(asIco(primOf('bath-terminal', 'glyph')).src).toEqual({
      kind: 'sprite',
      id: 'ico-term-shower',
    })
    expect(terminalSprite('shower')).toBe('ico-term-shower')
  })

  it('§7-87 ico-term-radiator：48 见方、10 处 currentColor；采暖末端与 **heating** 子类用它', () => {
    const symbol = symbolOf('ico-term-radiator')

    expect([symbol.viewBox, symbol.currentColor]).toEqual(['0 0 48 48', 10])
    expect(asIco(primOf('heating-terminal', 'glyph')).src).toEqual({
      kind: 'sprite',
      id: 'ico-term-radiator',
    })
    expect(terminalSprite('heating')).toBe('ico-term-radiator')
  })

  it('§7-88 ico-term-ac：48 见方、7 处 currentColor；空调末端与 **hvac** 子类用它（名字对不上取值，照字面改会得到一枚空白图标）', () => {
    const symbol = symbolOf('ico-term-ac')

    expect([symbol.viewBox, symbol.currentColor]).toEqual(['0 0 48 48', 7])
    expect(asIco(primOf('ac-terminal', 'glyph')).src).toEqual({
      kind: 'sprite',
      id: 'ico-term-ac',
    })
    expect(terminalSprite('hvac')).toBe('ico-term-ac')
  })

  it('§7-89 ico-tap：48 见方、5 处 currentColor，在册但预置样式暂无人用', () => {
    const symbol = symbolOf('ico-tap')

    expect([symbol.viewBox, symbol.currentColor]).toEqual(['0 0 48 48', 5])
    expect(TWIN_2D_SPRITE_IDS.some((id) => id === 'ico-tap')).toBe(true)
    expect(isFixedColor('ico-tap')).toBe(false)
  })

  it('§7-79–89 名单闭合：11 枚 symbol、4 个文档级渐变、固定色名单正好是前四枚', () => {
    expect(TWIN_2D_SPRITE_IDS.length).toBe(11)
    expect([...TWIN_2D_SPRITE_GRADIENT_IDS]).toEqual([
      'recoveryFill',
      'hxFill',
      'pumpFill',
      'solarFill',
    ])
    expect([...TWIN_2D_FIXED_COLOR_SPRITES]).toEqual([
      'ico-src-waste-heat',
      'ico-src-steam',
      'ico-src-air-source',
      'ico-src-solar',
    ])
  })
})

describe('§7.12 取值、格式化、状态归一与派生（11 件）', () => {
  it('§7-90 两套占位符：节点槽走 em dash「—」、传感器槽走两个 ASCII 连字符「--」，差异保留', () => {
    expect(TWIN_2D_DEFAULT_PLACEHOLDER).toBe('—')
    expect(TWIN_2D_SENSOR_PLACEHOLDER).toBe('--')
    for (const style of ALL_NODE_STYLES) {
      for (const slot of style.slots) {
        expect([style.id, slot.key, slot.placeholder]).toEqual([
          style.id,
          slot.key,
          '—',
        ])
      }
    }
    for (const def of TWIN_2D_SENSOR_DEFS) {
      expect(sensorSlotOf(def.slotKey).placeholder).toBe('--')
    }
  })

  it('§7-91 数值格式：precision 为 null 时整数直出、小数一位；给了数就定点补零；单位空格分隔', () => {
    const loose = fmtSlot('auto', null, '')
    const fixed = fmtSlot('auto', 2, 'kWh')

    expect(formatSlotValue(63, loose)).toBe('63')
    expect(formatSlotValue(63.44, loose)).toBe('63.4')
    // ⚠ 与 toFixed(1) 的差别是尾随零：这一档不补零
    expect(formatSlotValue(63.4, loose)).toBe('63.4')
    expect(formatSlotValue(63.4, fixed)).toBe('63.40 kWh')
    expect(formatSlotValue(null, loose)).toBe('—')
  })

  it('§7-92 enum 值查映射表，键是**字符串**（数值读数与字符串读数查到同一格）', () => {
    const status = slotOf(SOURCE, 'status')

    expect(status.enumMap).toEqual({
      '0': '离线',
      '1': '运行',
      '2': '待机',
      '3': '报警',
    })
    expect(formatSlotValue(1, status)).toBe('运行')
    expect(formatSlotValue('1', status)).toBe('运行')
    expect(formatSlotValue(3, status)).toBe('报警')
  })

  it('§7-93 kWh 短档真的落在主读数那一槽上：judge 用**取整后**的绝对值，999.6 与 1000 同显 1k', () => {
    const output = slotOf(SOURCE, 'output')

    expect([output.format, output.precision, output.unit]).toEqual([
      'kwhShort',
      0,
      '',
    ])
    // ⚠ 这一档的 precision 是「压缩后留几位」而不是「定点几位」：0 让 12345 显 12k，
    //   与参考项目 `abs >= 10000 → toFixed(0)` 那一支同值
    expect(formatSlotValue(12345, output)).toBe('12k')
    expect(formatSlotValue(999.6, output)).toBe('1k')
    expect(formatSlotValue(999.4, output)).toBe('999')
    expect(formatSlotValue(-2000, output)).toBe('-2k')
    // 档位本身仍是那台函数，precision 换成 2 就回到两位
    expect(fmtKwh(12345, 2)).toBe('12.35k')
  })

  it('§7-94 kWh 全档真的落在悬浮卡那两槽上：千分位 + kWh，locale 钉死 en-US', () => {
    for (const key of ['input_kwh', 'output_total']) {
      const slot = slotOf(SOURCE, key)

      expect([key, slot.format, slot.precision, slot.unit]).toEqual([
        key,
        'grouped',
        0,
        'kWh',
      ])
      expect([key, formatSlotValue(1234.6, slot)]).toEqual([key, '1,235 kWh'])
      expect([key, formatSlotValue(999999.5, slot)]).toEqual([
        key,
        '1,000,000 kWh',
      ])
    }
    expect(fmtNumber(Math.round(1234.6), 0)).toBe('1,235')
  })

  it('§7-95 能效那一槽走 trim2：两位、去尾随零，不是主读数那档的一位', () => {
    const efficiency = slotOf(SOURCE, 'efficiency')

    expect([efficiency.format, efficiency.precision, efficiency.unit]).toEqual([
      'trim2',
      null,
      '%',
    ])
    // ⚠ 单位与值之间那个空格是本仓全局口径（#91），参考项目那一处是拼死的 `%`——
    //   逐字符对不上的只有这一格，它由槽位数据驱动，用户想去掉自己改 unit 即可
    expect(formatSlotValue(63.456, efficiency)).toBe('63.46 %')
    expect(formatSlotValue(63.4, efficiency)).toBe('63.4 %')
    expect(formatSlotValue(63, efficiency)).toBe('63 %')
    expect(`${fmtTrim(63.456, 2)}%`).toBe('63.46%')
  })

  it('§7-96 状态归一：本包只认四档状态，一处都不再开第二份同义词表', () => {
    expect([...TWIN_2D_STATUSES]).toEqual([
      'online',
      'offline',
      'warning',
      'alarm',
    ])
    for (const word of ['disconnected', 'uncertain', 'degraded', 'critical']) {
      for (const [name, text] of allSources()) {
        expect([name, word, text.includes(word)]).toEqual([name, word, false])
      }
    }
  })

  it('§7-98 容器读数拼接落成派生槽 join(["temperature_c","level_pct"], " · ")', () => {
    const reading = slotOf('water-tank', 'reading')
    const expr = reading.expr
    if (expr === null) throw new Error('reading 不是派生槽')

    expect(reading.kind).toBe('derived')
    expect(expr).toEqual({
      kind: 'join',
      of: [
        { kind: 'slot', slot: 'temperature_c' },
        { kind: 'slot', slot: 'level_pct' },
      ],
      sep: ' · ',
    })
    expect(
      evalExpr(
        expr,
        new Map([
          ['temperature_c', 55],
          ['level_pct', 60],
        ]),
      ),
    ).toBe('55 · 60')
  })

  it('§7-99 能量兜底链：输出 first(output_kwh → today_kwh)，能效 first(efficiency_pct → cop×100 → 输出÷投入×100)', () => {
    const output = exprOf(SOURCE, 'output')
    const efficiency = exprOf(SOURCE, 'efficiency')

    expect(evalExpr(output, new Map([['today_kwh', 12]]))).toBe(12)
    expect(
      evalExpr(
        output,
        new Map([
          ['output_kwh', 8],
          ['today_kwh', 12],
        ]),
      ),
    ).toBe(8)
    expect(evalExpr(efficiency, new Map([['cop', 3.2]]))).toBe(320)
    expect(
      evalExpr(
        efficiency,
        new Map([
          ['output_kwh', 60],
          ['input_kwh', 80],
        ]),
      ),
    ).toBe(75)
    expect(
      evalExpr(
        efficiency,
        new Map([
          ['efficiency_pct', 91.5],
          ['cop', 3.2],
        ]),
      ),
    ).toBe(91.5)
  })

  it('§7-100 ⛔ legacyPrimaryFieldKey 不做：主显键就是它自己那一格，绑不上就出占位符，没有任何隐式改绑', () => {
    const primary = slotOf(TERMINAL, 'today_kwh')

    expect(primary.primary).toBe(true)
    // ⚠ 没有兜底算式：参考项目那条「source 改读 power_kw / terminal 改读 demand_kw」的兼容垫片不搬
    expect(primary.expr).toBe(null)
    expect(formatSlotValue(undefined, primary)).toBe('—')
    for (const style of ALL_NODE_STYLES) {
      for (const slot of style.slots.filter((one) => one.expr !== null)) {
        expect([style.id, slot.key, exprMentions(slot, 'demand_kw')]).toEqual([
          style.id,
          slot.key,
          false,
        ])
      }
    }
  })
})

describe('§7 收尾那三条「参考项目里根本不存在」的警告', () => {
  it('⛔ 罐形没有液位填充：水箱只有外壳 / 管接头 / 状态点三枚图元，一处都不按 level_pct 涂', () => {
    const tank = styleOf('water-tank')

    expect(tank.prims.map((prim) => prim.id)).toEqual([
      'frame',
      'stubs',
      'status-dot',
      'badge',
      'label-outer',
    ])
    // 那条 fill-opacity .25 的波形是静态图标的一部分（#83），不是液位
    expect(searchPrims(tank.prims, 'level')).toBe(null)
    for (const [name, text] of presetSources()) {
      expect([
        name,
        /level_pct[^']*fill|fill[^']*level_pct/.test(text),
      ]).toEqual([name, false])
    }
  })

  it('⛔ 次显数值不做：槽位只有 primary 一档，整个包里没有 secondary', () => {
    for (const [name, text] of allSources()) {
      expect([name, text.includes('secondaryField')]).toEqual([name, false])
    }
    for (const style of ALL_NODE_STYLES) {
      expect(style.slots.filter((slot) => slot.primary).length <= 1).toBe(true)
    }
  })
})

describe('内置库只是预置数据，不是渲染分支', () => {
  it('预置 id 与图元词汇表的重叠正好只有 label 一处（新的重叠必须先在这里现身）', () => {
    const overlap = presetIds().filter((id) => KIND_WORDS.has(id))

    expect(overlap).toEqual(['label'])
  })

  it('渲染件与 paint* 里一个预置样式 id 的字面量都没有——有了就是「预置数据长回了渲染分支」', () => {
    const scanned = presetIds().filter((id) => !KIND_WORDS.has(id))

    expect(scanned.length).toBeGreaterThan(20)
    for (const [name, text] of renderAndPaintSources()) {
      for (const id of scanned) {
        expect([name, id, text.includes(`'${id}'`)]).toEqual([name, id, false])
      }
    }
  })
})

describe('这份验收清单自己', () => {
  it('用例数不少于 100 条——删掉一半还报绿的话，这份清单就不是清单了', () => {
    const all = SPEC_SELF.match(/\bit\(\s*'/g)?.length ?? 0
    const numbered = SPEC_SELF.match(/\bit\(\s*'§7-/g)?.length ?? 0

    expect(all).toBeGreaterThanOrEqual(100)
    expect(numbered).toBeGreaterThanOrEqual(98)
  })

  // ⚠ 这条是棘轮：100 行里眼下 98 行有断言，缺的两行（#73 标注标签定位、
  //   #97 活跃与方向词表）在本包里根本没有对应实现——一个归标注视图（未建），
  //   一个住在 @dt/modules 的 shared/format。掉下去说明有人把已有的断言删了
  it('§7 那张 100 行表里有断言的行数不许倒退', () => {
    const rows = new Set(
      [...SPEC_SELF.matchAll(/\bit\(\s*'§7-(\d+)/g)].map((hit) => hit[1]),
    )

    expect(rows.size).toBeGreaterThanOrEqual(98)
    expect(rows.has('51')).toBe(true)
    expect(rows.has('56')).toBe(true)
  })
})
