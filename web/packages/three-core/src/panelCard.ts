/**
 * @fileoverview 一张信息牌的 DOM：外壳（挂点 / 引线 / 卡片 / 页眉页脚）与八种字段画法。
 *
 * ⚠ 全部文本走 `textContent`——牌名、副标题、字段标签、单位与静态文案都是用户可控
 * 文本，拼进 `innerHTML` 就是一个注入点（code-style-typescript §10）。
 * ⚠ 绝不在这里内联 border / background / border-radius / padding：内联样式的优先级
 * 压过样式表里的任何选择器，八种变体会全部长成一个样。逐牌不同的取色、尺寸与占比
 * 一律走 CSS 变量，观感留给 `styles/panel.scss` 按变体分。
 * ⚠ 挂点是一个 0×0 的容器：CSS3D 把元素按 `translate(-50%,-50%)` 摆在世界坐标上，
 * 尺寸为零时那个点正落在锚点上，卡片再相对它偏出去——这样「牌在锚点上方、一条引线
 * 连回来」才画得出来。卡片自己当挂点的话，偏移会把锚点一起带走。
 */
import type {
  TwinPanel,
  TwinPanelField,
  TwinPanelStyle,
  TwinPanelValues,
} from '@dt/twin-config'
import {
  formatValueText,
  panelFieldRatio,
  panelFieldTone,
  panelKindUsesSeries,
  toFiniteNumber,
} from '@dt/twin-config'

import { createMiniBars, createSparkline, type PanelChart } from './panelChart'

/** 没有读数、也没有静态文案时的占位符 */
export const NO_VALUE_TEXT = '—'

/** 卡片基准字号，px；`fontScale` 乘在它上面。 */
const BASE_FONT_PX = 11

/** 升降角标的三个字面量。 */
const DELTA_MARKS = { up: '▲', down: '▼', flat: '—' } as const

/** 一个字段在牌上的落点：刷新时只改这几个节点。 */
export interface PanelFieldView {
  field: TwinPanelField
  /** `<牌 id>::<字段 key>`，实时值按它索引。 */
  valueKey: string
  /** 整行的根，色档写在它的 `data-tone` 上。 */
  row: HTMLElement
  /** 读数文本的落点。 */
  valueEl: HTMLElement
  /** 单位单独成节点的那两档（大字与仪表）；其余为 null，单位已拼进读数里。 */
  unitEl: HTMLElement | null
  /** 迷你图；不攒序列的画法为 null。 */
  chart: PanelChart | null
  /** 升降角标；只有 `delta` 档有。 */
  deltaEl: HTMLElement | null
  /** 上一次的有限读数，`delta` 拿它比；没收到过是 null。 */
  last: number | null
}

/** 建好的一张牌。 */
export interface PanelCard {
  /** 挂给 CSS3D 的那个 0×0 容器。 */
  mount: HTMLElement
  /** 卡片本体。 */
  card: HTMLElement
  fields: PanelFieldView[]
}

/** 色规格 → 能写进 style 的字符串；token 要包一层 `var()`。 */
function cssColor(spec: string): string {
  return spec.startsWith('--') ? `var(${spec})` : spec
}

/**
 * 把这张牌的个性写成 CSS 变量与开关属性，挂在外层容器上让卡片与引线一起继承。
 * @param mount 挂点容器
 * @param panel 归一化后的信息牌
 */
function styleMount(mount: HTMLElement, panel: TwinPanel): void {
  const { style } = panel
  mount.style.setProperty('--tp-accent', cssColor(style.accent))
  mount.style.setProperty(
    '--tp-bg',
    style.background === ''
      ? 'var(--surface-overlay)'
      : cssColor(style.background),
  )
  mount.style.setProperty(
    '--tp-font-size',
    `${(BASE_FONT_PX * style.fontScale).toFixed(1)}px`,
  )
  if (style.width > 0) mount.style.setProperty('--tp-width', `${style.width}px`)
  if (style.height > 0) {
    mount.style.setProperty('--tp-height', `${style.height}px`)
  }
  mount.dataset.orient = style.orient
  if (style.pulse) mount.dataset.pulse = 'on'
  if (style.animate) mount.dataset.animate = 'on'
}

/** 卡片自己的版式开关；观感全部由样式表按这两个属性分。 */
function flagCard(card: HTMLElement, style: TwinPanelStyle): void {
  card.dataset.density = style.density
  card.dataset.columns = String(style.columns)
}

/**
 * 外壳层：背景、描边、切角与投影都画在它身上，卡片本体不带这些。
 * ⚠ 这是「四角括号在切角变体上不见了」的修法：`clip-path` 连**后代一起裁**，
 * 画在卡片上时把装饰层与内容一并切掉，而配置里明明开着。切角只裁这一层，
 * 装饰与内容就都逃得出来。
 */
function buildShell(): HTMLElement {
  const shell = span('twin-panel__shell')
  shell.setAttribute('aria-hidden', 'true')
  return shell
}

/**
 * 三层装饰各出一个自己的节点，不共用伪元素。
 * ⚠ 挤在 `::before` / `::after` 上时，「战术 HUD + 四角括号」这类组合会互相覆盖：
 * 后写的那条选择器赢，另一件装饰安静地不见了，而配置里明明两个都开着。
 */
function buildDecor(style: TwinPanelStyle): HTMLElement[] {
  const decor: HTMLElement[] = []
  if (style.grid) decor.push(span('twin-panel__grid'))
  if (style.scan) decor.push(span('twin-panel__scan'))
  if (style.corners) decor.push(span('twin-panel__corners'))
  for (const item of decor) item.setAttribute('aria-hidden', 'true')
  return decor
}

function span(className: string, text = ''): HTMLElement {
  const el = document.createElement('span')
  el.className = className
  if (text !== '') el.textContent = text
  return el
}

function div(className: string): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  return el
}

/** 页眉：副标题那行小字压在标题上；两个都空就不画。 */
function buildHead(panel: TwinPanel): HTMLElement | null {
  if (panel.name === '' && panel.subtitle === '') return null
  const head = div('twin-panel__head')
  if (panel.subtitle !== '') {
    head.append(span('twin-panel__eyebrow', panel.subtitle))
  }
  if (panel.name !== '') {
    const title = div('twin-panel__title')
    title.textContent = panel.name
    head.append(title)
  }
  return head
}

/** 页脚：一行小字配三个指示块；文案空就不画。 */
function buildFoot(panel: TwinPanel): HTMLElement | null {
  if (panel.footnote === '') return null
  const foot = div('twin-panel__foot')
  foot.append(span('twin-panel__note', panel.footnote))
  const ticks = div('twin-panel__ticks')
  for (let index = 0; index < 3; index += 1) {
    ticks.append(document.createElement('i'))
  }
  foot.append(ticks)
  return foot
}

/** 标签行左侧那段文字：大字与仪表两档把前缀提到标签里，读数只留数值。 */
function labelText(field: TwinPanelField): string {
  if (field.kind !== 'hero' && field.kind !== 'gauge') return field.label
  return [field.prefix, field.label].filter((part) => part !== '').join(' ')
}

/** 一行的头：左标签右读数。 */
function buildLine(field: TwinPanelField): {
  line: HTMLElement
  valueEl: HTMLElement
} {
  const line = div('twin-panel__line')
  line.append(span('twin-panel__label', labelText(field)))
  const valueEl = span('twin-panel__value', NO_VALUE_TEXT)
  line.append(valueEl)
  return { line, valueEl }
}

/** 数值与单位分开成节点的那两档共用的落点。 */
interface SplitRow {
  row: HTMLElement
  valueEl: HTMLElement
  unitEl: HTMLElement
}

/** 大字主指标：标签在上，数值与单位在下。 */
function buildHero(field: TwinPanelField): SplitRow {
  const row = div('twin-panel__row')
  row.dataset.kind = 'hero'
  row.append(span('twin-panel__label', labelText(field)))
  const stack = div('twin-panel__hero')
  const valueEl = span('twin-panel__num', NO_VALUE_TEXT)
  const unitEl = span('twin-panel__unit', field.unit)
  stack.append(valueEl, unitEl)
  row.append(stack)
  return { row, valueEl, unitEl }
}

/** 环形仪表：圆环按占比填，数值压在圆心。 */
function buildGauge(field: TwinPanelField): SplitRow {
  const row = div('twin-panel__row')
  row.dataset.kind = 'gauge'
  const ring = div('twin-panel__ring')
  const valueEl = span('twin-panel__num', NO_VALUE_TEXT)
  ring.append(valueEl)
  const meta = div('twin-panel__ring-meta')
  const unitEl = span('twin-panel__unit', field.unit)
  meta.append(span('twin-panel__label', labelText(field)), unitEl)
  row.append(ring, meta)
  return { row, valueEl, unitEl }
}

/** 头一行加一件附属图形的那几档。 */
function buildLined(
  field: TwinPanelField,
  extra: Element | null,
): { row: HTMLElement; valueEl: HTMLElement; deltaEl: HTMLElement | null } {
  const row = div('twin-panel__row')
  row.dataset.kind = field.kind
  const { line, valueEl } = buildLine(field)
  let deltaEl: HTMLElement | null = null
  if (field.kind === 'dot') {
    line.prepend(span('twin-panel__dot'))
  }
  if (field.kind === 'delta') {
    deltaEl = span('twin-panel__delta', DELTA_MARKS.flat)
    line.append(deltaEl)
  }
  row.append(line)
  if (extra !== null) row.append(extra)
  return { row, valueEl, deltaEl }
}

/** 进度条的槽；填多少由 `--tp-fill` 决定。 */
function buildTrack(): HTMLElement {
  const track = div('twin-panel__track')
  track.append(document.createElement('i'))
  return track
}

/** 这一档要不要一件附属图形，以及它是不是一张攒序列的迷你图。 */
function extraOf(field: TwinPanelField): {
  element: Element | null
  chart: PanelChart | null
} {
  if (field.kind === 'bar') return { element: buildTrack(), chart: null }
  if (field.kind === 'sparkline') {
    const chart = createSparkline()
    return { element: chart.el, chart }
  }
  if (field.kind === 'bars') {
    const chart = createMiniBars()
    return { element: chart.el, chart }
  }
  return { element: null, chart: null }
}

function buildFieldView(
  panelId: string,
  field: TwinPanelField,
): PanelFieldView {
  const valueKey = `${panelId}::${field.key}`
  const shared = { field, valueKey, chart: null, deltaEl: null, last: null }
  if (field.kind === 'hero') return { ...shared, ...buildHero(field) }
  if (field.kind === 'gauge') return { ...shared, ...buildGauge(field) }
  const { element, chart } = extraOf(field)
  return { ...shared, ...buildLined(field, element), unitEl: null, chart }
}

/**
 * 建一张牌的全部 DOM。
 * @param panel 归一化后的信息牌
 */
export function buildPanelCard(panel: TwinPanel): PanelCard {
  const mount = div('twin-panel-mount')
  styleMount(mount, panel)

  const card = div('twin-panel')
  card.classList.add(`twin-panel--${panel.style.variant}`)
  flagCard(card, panel.style)

  card.append(buildShell())
  const head = buildHead(panel)
  if (head !== null) card.append(head)
  const body = div('twin-panel__body')
  const fields = panel.fields.map((field) => {
    const view = buildFieldView(panel.id, field)
    body.append(view.row)
    return view
  })
  card.append(body)
  const foot = buildFoot(panel)
  if (foot !== null) card.append(foot)
  card.append(...buildDecor(panel.style))

  // 引线与锚点小环画在卡片之前，卡片才压在它们上面
  if (panel.style.orient !== 'center') {
    mount.append(div('twin-panel-lead'), div('twin-panel-anchor'))
  }
  mount.append(card)
  return { mount, card, fields }
}

/** 一路读数当前该显示什么。 */
interface Reading {
  /** 数值本体，或退回的静态文案 / 占位符。 */
  num: string
  /** `前缀 数值 单位` 三段拼好。 */
  text: string
  unit: string
  /** 拿到实时读数了没有。 */
  live: boolean
  /** 实时读数原值；没有实时值时是 undefined。 */
  raw: unknown
}

/**
 * 一个字段当前的读数。
 *
 * ⚠ 「有没有实时值」看的是**数值本身拼不拼得出来**，不是拼完前缀单位之后的整串：
 * 按整串判的话，一个配了前缀的字段收到 NaN 会只显示前缀两个字，既不退回静态文案
 * 也看不出是取不到数。
 * ⚠ 没有读数时也要把前缀与单位拼上：编辑器里五路实时值恒空，只显示一个占位符的话，
 * 用户配了前缀和单位完全看不到反馈，只能保存后到大屏上去猜配对没配对。
 */
function readingOf(view: PanelFieldView, values: TwinPanelValues): Reading {
  const live = values[view.valueKey]
  const numeric =
    live === undefined
      ? ''
      : formatValueText(
          { prefix: '', unit: '', decimals: view.field.decimals },
          live.value,
        )
  const hasLive = numeric !== ''
  const fallback =
    view.field.staticText === '' ? NO_VALUE_TEXT : view.field.staticText
  const num = hasLive ? numeric : fallback
  return {
    num,
    text: [view.field.prefix, num, view.field.unit]
      .filter((part) => part !== '')
      .join(' '),
    unit: view.field.unit,
    live: hasLive,
    raw: hasLive ? live?.value : undefined,
  }
}

/** 色档落在整行上；没命中就把属性摘掉，回到牌的主题色。 */
function paintTone(view: PanelFieldView, reading: Reading): void {
  const tone = reading.live ? panelFieldTone(view.field, reading.raw) : null
  if (tone === null) delete view.row.dataset.tone
  else view.row.dataset.tone = tone
}

/** 升降角标：与上一次的有限读数比。 */
function paintDelta(view: PanelFieldView, reading: Reading): void {
  if (view.deltaEl === null) return
  const now = reading.live ? toFiniteNumber(reading.raw) : null
  const previous = view.last
  const direction =
    now === null || previous === null
      ? 'flat'
      : now > previous
        ? 'up'
        : now < previous
          ? 'down'
          : 'flat'
  view.deltaEl.dataset.dir = direction
  view.deltaEl.textContent = DELTA_MARKS[direction]
  if (now !== null) view.last = now
}

/**
 * 把一路读数刷到它那一行上：文本、色档、量程占比与迷你图。
 * @param view 这一行的落点
 * @param values 缝合后的信息牌字段值
 */
export function paintPanelField(
  view: PanelFieldView,
  values: TwinPanelValues,
): void {
  const reading = readingOf(view, values)
  if (view.unitEl === null) {
    view.valueEl.textContent = reading.text
  } else {
    view.valueEl.textContent = reading.num
    view.unitEl.textContent = reading.unit
  }
  paintTone(view, reading)
  // ⚠ 「还没有读数」要落成一个属性：样式表按它把骨架显出来、把大字占位符缩回
  //   正常字号（缘由见 `styles/panel.scss` 的骨架那一节）。
  if (reading.live) delete view.row.dataset.empty
  else view.row.dataset.empty = 'on'
  const ratio = reading.live ? panelFieldRatio(view.field, reading.raw) : null
  if (ratio === null) view.row.style.removeProperty('--tp-fill')
  else view.row.style.setProperty('--tp-fill', ratio.toFixed(3))
  // ⚠ 只有攒序列的那两档才推，否则每次刷新都会给别的画法白攒一份数组
  if (panelKindUsesSeries(view.field.kind)) view.chart?.push(ratio)
  paintDelta(view, reading)
}
