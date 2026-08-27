/**
 * @fileoverview 守一格的取值：四档状态、三种值类型的格式化、值规则命中与逐格纯色、
 * 涨跌块的四种算法，以及渐变文字那三个（这里是四个）前提。
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），只有 `meta.slots` 分得开；合成一档
 * 既不报错也测不出来，墙上只是把「现场断了」画成了「还没配」。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildCardCells,
  CARD_ITEMS_KEY,
  CARD_SLOT_KEY,
  cardFieldKey,
  IC_CELL_VAR_NAMES,
  readCardItems,
  type CardCell,
} from '../../../src/modules/info-card/cells'

/** 一格配置 + 一格注入值 → 那一格的视图，省掉每条用例都摊一遍两层数组。 */
function cellOf(
  item: Record<string, unknown>,
  raw: Record<string, unknown> | undefined = undefined,
  config: Record<string, unknown> = {},
): CardCell {
  const [cell] = buildCardCells({
    config: { ...config, [CARD_ITEMS_KEY]: [item] },
    rows: raw === undefined ? [] : [raw],
    slots: undefined,
  })
  if (cell === undefined) throw new Error('这条用例本该摊出一格')
  return cell
}

/** 带逐槽结论的一格：`slots` 一给，四档就由取数侧说了算。 */
function slotCell(
  slot: ModuleSlotMeta | undefined,
  raw: Record<string, unknown> | undefined = undefined,
  item: Record<string, unknown> = { label: '一号机', unit: 'kW' },
): CardCell {
  const [cell] = buildCardCells({
    config: { [CARD_ITEMS_KEY]: [item] },
    rows: raw === undefined ? [] : [raw],
    slots: slot === undefined ? {} : { [cardFieldKey(0, 'value')]: slot },
  })
  if (cell === undefined) throw new Error('这条用例本该摊出一格')
  return cell
}

describe('格列表的归一化', () => {
  it('缺什么补什么，脏行也占一格——丢一格会让它之后每条绑定改喂另一格', () => {
    expect(readCardItems(['不是对象', null]).length).toBe(2)
    expect(readCardItems('不是数组')).toEqual([])
  })

  it('每一项的缺省与参考仓逐项对齐', () => {
    expect(readCardItems([{}])[0]).toEqual({
      label: '',
      unit: '',
      precision: 1,
      kind: 'number',
      trueText: '运行',
      falseText: '停止',
      emoji: '',
      icon: '',
      color: '',
      emitValue: '',
    })
  })

  it('小数位取整并夹到 [0,6]，单位一个空格都不许 trim', () => {
    const items = readCardItems([
      { precision: -3, unit: '° C' },
      { precision: 9.7 },
    ])

    expect(items[0]?.precision).toBe(0)
    expect(items[0]?.unit).toBe('° C')
    expect(items[1]?.precision).toBe(6)
  })

  it('值类型只认白名单，认不出的回落数值档', () => {
    expect(readCardItems([{ valueKind: 'text' }])[0]?.kind).toBe('text')
    expect(readCardItems([{ valueKind: 'nope' }])[0]?.kind).toBe('number')
  })

  it('素材引用没装解析器时给空串，不把 asset: 原样漏进 img', () => {
    expect(readCardItems([{ icon: 'asset:abc' }])[0]?.icon).toBe('')
    expect(readCardItems([{ icon: '/logo.png' }])[0]?.icon).toBe('/logo.png')
  })
})

describe('子槽键两侧对得上', () => {
  it('槽键与下标拼成绑定那一侧的 fieldKey', () => {
    expect(cardFieldKey(2, 'aux')).toBe(`${CARD_SLOT_KEY}[2].aux`)
  })
})

describe('四档状态', () => {
  it('没下发逐槽结论时只看有没有值：没有就是没配来源', () => {
    expect(slotCell(undefined).state).toBe('unbound')
  })

  it('下发了结论但这一格没有槽，就是没配来源', () => {
    const cell = buildCardCells({
      config: { [CARD_ITEMS_KEY]: [{ label: '一号机' }] },
      rows: [{ value: 12 }],
      slots: { [cardFieldKey(9, 'value')]: { state: 'ok' } },
    })[0]

    expect(cell?.state).toBe('unbound')
  })

  it('等首帧与没配来源显示的是同一个占位符', () => {
    const pending = slotCell({ state: 'pending' })
    const unbound = slotCell(undefined)

    expect(pending.text).toBe(unbound.text)
    expect(pending.text).toBe('—')
  })

  it('两档只有 state 与那一句话不同——屏上全靠颜色与透明度分开', () => {
    const pending = slotCell({ state: 'pending' })
    const unbound = slotCell(undefined)

    expect([pending.state, unbound.state]).toEqual(['pending', 'unbound'])
    expect(pending.reason).toBe('已绑定，还没收到第一帧')
    expect(unbound.reason).toBe('这一格还没绑定数据来源')
  })

  it('取不到那一档把取数侧给的原因缀在后面', () => {
    const cell = slotCell({ state: 'error', message: '点位不存在' })

    expect(cell.state).toBe('error')
    expect(cell.reason).toBe('取不到：点位不存在')
  })

  it('取不到但没给原因时只留那一句话', () => {
    expect(slotCell({ state: 'error' }).reason).toBe('取不到')
  })

  it('单位只在有值那一档画——「— kV」看着像是有读数的', () => {
    expect(slotCell({ state: 'pending' }).unit).toBe('')
    expect(slotCell({ state: 'ok' }, { value: 3 }).unit).toBe('kW')
  })

  it('有值那一档不给原因，鼠标停上去不该冒出一句话', () => {
    expect(slotCell({ state: 'ok' }, { value: 3 }).reason).toBe('')
  })

  it('没下发结论但注入了值时按有值算：设计态画布走这条', () => {
    expect(cellOf({ label: '一号机' }, { value: 0 }).state).toBe('ok')
    expect(cellOf({ label: '一号机' }, { value: 0 }).text).toBe('0')
  })
})

describe('三种值类型', () => {
  it('数值档按小数位取最多几位，缺省不带千分位', () => {
    expect(cellOf({ precision: 1 }, { value: 1234.56 }).text).toBe('1234.6')
  })

  it('千分位与固定小数位各管一件事，可以叠', () => {
    const grouped = cellOf(
      { precision: 1 },
      { value: 1234 },
      { thousands: true },
    )
    const fixed = cellOf(
      { precision: 2 },
      { value: 1234 },
      { thousands: true, fixedDecimals: true },
    )

    expect(grouped.text).toBe('1,234')
    expect(fixed.text).toBe('1,234.00')
  })

  it('真实 0 显 0，不显占位符', () => {
    expect(cellOf({ precision: 0 }, { value: 0 }).text).toBe('0')
  })

  it('开关量认数值 0/1，不是只认 JSON 布尔', () => {
    expect(cellOf({ valueKind: 'boolean' }, { value: 1 }).text).toBe('运行')
    expect(cellOf({ valueKind: 'boolean' }, { value: 0 }).text).toBe('停止')
    expect(cellOf({ valueKind: 'boolean' }, { value: true }).text).toBe('运行')
  })

  it('开关量的两句话可以改', () => {
    const cell = cellOf(
      { valueKind: 'boolean', trueText: '合闸', falseText: '分闸' },
      { value: 0 },
    )

    expect(cell.text).toBe('分闸')
  })

  it('开关量收到认不出的值时照实显示，不静默说成「停止」', () => {
    expect(cellOf({ valueKind: 'boolean' }, { value: '检修' }).text).toBe(
      '检修',
    )
  })

  it('文本档不做数字格式化——那一档装的是原样上墙的字', () => {
    expect(
      cellOf({ valueKind: 'text', precision: 1 }, { value: 1.2345 }).text,
    ).toBe('1.2345')
    expect(cellOf({ valueKind: 'text' }, { value: '东南风' }).text).toBe(
      '东南风',
    )
  })

  it('数值档收到字符串时照实显示原文', () => {
    expect(cellOf({}, { value: '离线' }).text).toBe('离线')
  })

  it('数值档收到布尔时也照实显示，不静默算成 0/1', () => {
    expect(cellOf({}, { value: true }).text).toBe('true')
    expect(cellOf({}, { value: false }).text).toBe('false')
  })

  it('槽说有值、注入袋里却没有这一格时退回占位符', () => {
    const cell = slotCell({ state: 'ok' }, {}, { label: '一号机', unit: 'kW' })

    expect(cell.state).toBe('ok')
    expect(cell.text).toBe('—')
  })

  it('占位符可配，留空回落全平台那一个', () => {
    expect(cellOf({}, {}, { emptyText: '无' }).text).toBe('无')
    expect(cellOf({}, {}, { emptyText: '   ' }).text).toBe('—')
  })
})

describe('值规则与逐格纯色', () => {
  const rules = [
    { op: 'gte', value: 90, level: 'danger', label: '超限', blink: true },
    { op: 'gte', value: 70, level: 'warning', color: 'var(--state-warning)' },
  ]

  it('命中高危那一条：声明序取首个，高危在前', () => {
    const cell = cellOf({}, { value: 95 }, { rules })

    expect(cell.label).toBe('超限')
    expect(cell.labelIsHit).toBe(true)
    expect(cell.blink).toBe(true)
    expect(cell.vars['--ic-cell-color']).toBe('var(--state-danger)')
  })

  it('规则自带的颜色盖掉语义色', () => {
    expect(cellOf({}, { value: 75 }, { rules }).vars['--ic-cell-color']).toBe(
      'var(--state-warning)',
    )
  })

  it('没命中就没有颜色键，由样式表的兜底接手', () => {
    const cell = cellOf({}, { value: 10 }, { rules })

    expect(cell.vars['--ic-cell-color']).toBeUndefined()
    expect(cell.labelIsHit).toBe(false)
  })

  it('命中色压过逐格静态色——静态色是身份，告警是此刻的事实', () => {
    const cell = cellOf(
      { color: 'var(--accent-secondary)' },
      { value: 95 },
      { rules },
    )

    expect(cell.vars['--ic-cell-color']).toBe('var(--state-danger)')
  })

  it('没命中时逐格静态色照旧染这一格', () => {
    const cell = cellOf(
      { color: 'var(--accent-secondary)' },
      { value: 1 },
      { rules },
    )

    expect(cell.vars['--ic-cell-color']).toBe('var(--accent-secondary)')
  })

  it('只有数值档评估规则：文本与开关量命中不了阈值', () => {
    const text = cellOf({ valueKind: 'text' }, { value: 95 }, { rules })
    const flag = cellOf({ valueKind: 'boolean' }, { value: 95 }, { rules })

    expect(text.blink).toBe(false)
    expect(flag.vars['--ic-cell-color']).toBeUndefined()
  })

  it('没有读数时一律不判规则：凭空一个颜色等于宣布「一切正常」', () => {
    const cell = slotCell(
      { state: 'error' },
      { value: 95 },
      { valueKind: 'number' },
    )

    expect(cell.vars['--ic-cell-color']).toBeUndefined()
    expect(cell.dot).toBeNull()
  })

  it('命中文案顶掉行内标签，没有文案时标签原样留着', () => {
    expect(cellOf({ label: '出水温度' }, { value: 95 }, { rules }).label).toBe(
      '超限',
    )
    expect(cellOf({ label: '出水温度' }, { value: 75 }, { rules }).label).toBe(
      '出水温度',
    )
  })
})

describe('状态点', () => {
  const rules = [{ op: 'gt', value: 1, level: 'info', label: '' }]

  it('命中时才画点：没有判据就连「正常」都不该说', () => {
    const on = cellOf({}, { value: 9 }, { rules, statusDot: 'auto' })
    const miss = cellOf({}, { value: 0 }, { rules, statusDot: 'auto' })

    expect(on.dot).toEqual({ level: 'info', text: '提示' })
    expect(miss.dot).toBeNull()
  })

  it('不画那一档命中了也不画', () => {
    expect(
      cellOf({}, { value: 9 }, { rules, statusDot: 'none' }).dot,
    ).toBeNull()
  })

  it('点的颜色跟命中的那条规则，不跟逐格静态色', () => {
    const cell = cellOf(
      { color: 'var(--accent-secondary)' },
      { value: 9 },
      {
        rules: [
          { op: 'gt', value: 1, level: 'info', color: 'var(--state-warning)' },
        ],
        statusDot: 'auto',
      },
    )

    expect(cell.vars['--ic-dot-color']).toBe('var(--state-warning)')
    expect(cell.dot?.text).toBe('提示')
  })
})

describe('渐变文字的四个前提', () => {
  const on = { valueFill: 'gradient' }

  it('四个都成立才渐变', () => {
    expect(cellOf({}, { value: 12 }, on).gradient).toBe(true)
  })

  it('没开渐变档就不渐变', () => {
    expect(cellOf({}, { value: 12 }).gradient).toBe(false)
  })

  it('这一格有纯色覆盖时不渐变——告警色会被 background-clip 洗掉', () => {
    const byItem = cellOf({ color: 'var(--state-info)' }, { value: 12 }, on)
    const byRule = cellOf(
      {},
      { value: 12 },
      { ...on, rules: [{ op: 'gt', value: 1 }] },
    )

    expect(byItem.gradient).toBe(false)
    expect(byRule.gradient).toBe(false)
  })

  it('没资格用数字字体的值不渐变', () => {
    expect(
      cellOf({ valueKind: 'text' }, { value: '东南风' }, on).gradient,
    ).toBe(false)
  })

  it('关掉「文本值回退纯色」之后文本值也吃渐变', () => {
    const cell = cellOf(
      { valueKind: 'text' },
      { value: '东南风' },
      { ...on, textPlainFallback: false },
    )

    expect(cell.gradient).toBe(true)
    expect(cell.digit).toBe(true)
  })

  it('没有读数那一档不渐变：四档只靠颜色分得开', () => {
    const cell = slotCell({ state: 'pending' }, undefined, {})

    expect(cell.gradient).toBe(false)
  })
})

describe('涨跌块', () => {
  const shown = { compare: { show: true } }

  it('没开对比就不画', () => {
    expect(cellOf({}, { value: 12, aux: 10 }).compare).toBeNull()
  })

  it('当前值与对比值任一缺席都不画', () => {
    expect(cellOf({}, { value: 12 }, shown).compare).toBeNull()
    expect(cellOf({}, { aux: 10 }, shown).compare).toBeNull()
  })

  it('百分比档：涨用实心上箭头', () => {
    const cell = cellOf({ precision: 1 }, { value: 12, aux: 10 }, shown)

    expect(cell.compare).toEqual({
      dir: 'up',
      arrow: '▲',
      text: '20%',
      label: '',
    })
  })

  it('绝对差值档按读数自己的小数位与千分位格式化', () => {
    const cell = cellOf(
      { precision: 0 },
      { value: 12000, aux: 10000 },
      { thousands: true, compare: { show: true, mode: 'delta' } },
    )

    expect(cell.compare?.text).toBe('2,000')
  })

  it('两样都要那一档把百分比括起来', () => {
    const cell = cellOf(
      { precision: 0 },
      { value: 12, aux: 10 },
      { compare: { show: true, mode: 'both' } },
    )

    expect(cell.compare?.text).toBe('2 (20%)')
  })

  it('百分比档基数为 0 时回退显绝对差值，不留空', () => {
    const cell = cellOf({ precision: 0 }, { value: 12, aux: 0 }, shown)

    expect(cell.compare?.text).toBe('12')
  })

  it('跌是空心下箭头，配色是坏的那一头', () => {
    const cell = cellOf({}, { value: 8, aux: 10 }, shown)

    expect(cell.compare?.dir).toBe('down')
    expect(cell.compare?.arrow).toBe('▼')
    expect(cell.vars['--ic-trend']).toBe('var(--state-danger)')
  })

  it('下降为好那一档把好坏反过来', () => {
    const cell = cellOf(
      {},
      { value: 8, aux: 10 },
      { compare: { show: true, invertTrend: true } },
    )

    expect(cell.vars['--ic-trend']).toBe('var(--state-success)')
  })

  it('涨在缺省口径下是好的', () => {
    expect(cellOf({}, { value: 12, aux: 10 }, shown).vars['--ic-trend']).toBe(
      'var(--state-success)',
    )
  })

  it('持平是中性色加一道横线', () => {
    const cell = cellOf({}, { value: 10, aux: 10 }, shown)

    expect(cell.compare?.dir).toBe('flat')
    expect(cell.compare?.arrow).toBe('—')
    expect(cell.vars['--ic-trend']).toBe('var(--text-secondary)')
  })

  it('注脚原样带出来', () => {
    const cell = cellOf(
      {},
      { value: 12, aux: 10 },
      {
        compare: { show: true, label: '较上期' },
      },
    )

    expect(cell.compare?.label).toBe('较上期')
  })

  it('没有读数那一档不画涨跌块', () => {
    const [cell] = buildCardCells({
      config: { [CARD_ITEMS_KEY]: [{}], compare: { show: true } },
      rows: [{ value: 12, aux: 10 }],
      slots: { [cardFieldKey(0, 'value')]: { state: 'error' } },
    })

    expect(cell?.compare).toBeNull()
    expect(cell?.vars['--ic-trend']).toBeUndefined()
  })
})

describe('格的键与逐格变量', () => {
  it('键由格身份派生，不含下标——重排配置时同一逻辑格的键不变', () => {
    const cells = buildCardCells({
      config: { [CARD_ITEMS_KEY]: [{ label: '甲' }, { label: '乙' }] },
      rows: [],
      slots: undefined,
    })
    const swapped = buildCardCells({
      config: { [CARD_ITEMS_KEY]: [{ label: '乙' }, { label: '甲' }] },
      rows: [],
      slots: undefined,
    })

    expect(cells[0]?.key).toBe(swapped[1]?.key)
  })

  it('两格完全同配置时仍得到不同的键', () => {
    const cells = buildCardCells({
      config: { [CARD_ITEMS_KEY]: [{ label: '甲' }, { label: '甲' }] },
      rows: [],
      slots: undefined,
    })

    expect(cells[0]?.key).not.toBe(cells[1]?.key)
  })

  it('下标是文档序，取绑定槽与派生行都靠它', () => {
    const cells = buildCardCells({
      config: { [CARD_ITEMS_KEY]: [{}, {}, {}] },
      rows: [],
      slots: undefined,
    })

    expect(cells.map((cell) => cell.index)).toEqual([0, 1, 2])
  })

  it('三个逐格变量全都摊得出来，一个都不是写死的名字', () => {
    const cell = cellOf(
      {},
      { value: 95, aux: 10 },
      {
        rules: [{ op: 'gt', value: 1, level: 'danger' }],
        statusDot: 'auto',
        compare: { show: true },
      },
    )

    expect(
      IC_CELL_VAR_NAMES.filter((name) => cell.vars[name] === undefined),
    ).toEqual([])
  })

  it('什么都没有的格一个变量都不注入', () => {
    expect(cellOf({}, { value: 1 }).vars).toEqual({})
  })

  it('联动值原样带出来，空串 = 点了不上抛', () => {
    expect(cellOf({ emitValue: ' a ' }, {}).emitValue).toBe('a')
    expect(cellOf({}, {}).emitValue).toBe('')
  })
})
