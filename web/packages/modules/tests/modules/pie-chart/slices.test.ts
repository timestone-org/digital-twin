/**
 * @fileoverview 守构成环图的取值层：扇区列表的归一化、逐片四档状态、
 * 「进不进扇区」那四条判据（等首帧 / 取不到 / 无读数 / 负值）、占比只按当前
 * 可画的那几片归一，以及签名、读屏摘要与绑点面板那两份派生。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开；
 * 合成一档的代价是「还没绑」与「取不到」在墙上是同一片空白。
 * ⚠ 「读数全是 0」与「一片都画不出来」是两回事，空态那两句因此各钉一条。
 * ⚠ 占比的分母错了不会报错：接了 2 片却按 6 片归一，屏上只是两小条加一大块空白。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  ariaSummaryOf,
  buildSliceViews,
  emptyStateOf,
  PIE_EMPTY_TEXT,
  PIE_ZERO_TEXT,
  readPieFormat,
  readSliceItems,
  signatureOf,
  SLICE_ITEMS_KEY,
  SLICE_NOTES,
  SLICE_SLOT_KEY,
  sliceFieldKey,
  sliceRowCounts,
  sliceRowLabels,
  type SliceView,
} from '../../../src/modules/pie-chart/slices'

type Slots = Record<string, ModuleSlotMeta>

const THREE = [
  { name: '光伏', unit: 'kWh' },
  { name: '市电', unit: 'kWh' },
  { name: '储能', unit: 'kWh' },
]

/** 注入袋：逐片的读数，按文档序。 */
function readings(...numbers: unknown[]): unknown {
  return numbers.map((value) => ({ value }))
}

/** 全部子槽都是 ok 的一份逐槽结论。 */
function allOk(count: number): Slots {
  const slots: Slots = {}
  for (let index = 0; index < count; index += 1) {
    slots[sliceFieldKey(index)] = { state: 'ok' }
  }
  return slots
}

function build(
  config: Record<string, unknown>,
  rows: unknown,
  slots?: Slots,
): SliceView[] {
  return buildSliceViews({ config, rows, slots })
}

describe('扇区列表的归一化', () => {
  it('非数组给空列表，脏行补默认而不丢行', () => {
    expect(readSliceItems('不是数组')).toEqual([])
    expect(readSliceItems([null, { name: ' 光伏 ' }])).toEqual([
      { name: '', color: '', unit: '', precision: null },
      { name: '光伏', color: '', unit: '', precision: null },
    ])
  })

  it('单位不去首尾空格，小数位收数字串', () => {
    const items = readSliceItems([{ unit: '° C', precision: '3' }])

    expect(items[0]?.unit).toBe('° C')
    expect(items[0]?.precision).toBe(3)
  })

  it('整块的单位与小数位缺省是空单位与两位', () => {
    expect(readPieFormat({})).toEqual({ unit: '', precision: 2 })
    expect(readPieFormat({ unit: 'kW', precision: 0 })).toEqual({
      unit: 'kW',
      precision: 0,
    })
  })

  it('子槽的 fieldKey 按文档序拼', () => {
    expect(sliceFieldKey(2)).toBe(`${SLICE_SLOT_KEY}[2].value`)
  })
})

describe('逐片四档', () => {
  it('没配来源的那几片整片不进输出，图例也无从列它', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: THREE },
      readings(10, undefined, 30),
      {
        [sliceFieldKey(0)]: { state: 'ok' },
        [sliceFieldKey(2)]: { state: 'ok' },
      },
    )

    expect(views.map((view) => view.index)).toEqual([0, 2])
  })

  it('等首帧与取不到都列名字，各带各的后缀且不进扇区', () => {
    const views = build({ [SLICE_ITEMS_KEY]: THREE }, readings(10), {
      [sliceFieldKey(0)]: { state: 'ok' },
      [sliceFieldKey(1)]: { state: 'pending' },
      [sliceFieldKey(2)]: { state: 'error', message: '点位已删除' },
    })

    expect(views.map((view) => view.legendName)).toEqual([
      '光伏',
      `市电（${SLICE_NOTES.pending}）`,
      `储能（${SLICE_NOTES.error}）`,
    ])
    expect(views.map((view) => view.value)).toEqual([10, null, null])
  })

  it('说是 ok 却没有有限数时按无读数处理，不伪造 0', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: [THREE[0]] },
      readings(Number.NaN),
      allOk(1),
    )

    expect(views[0]?.note).toBe(SLICE_NOTES.missing)
    expect(views[0]?.value).toBeNull()
  })

  it('负值整片剔除并在图例上说明，不取绝对值混进去', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: THREE },
      readings(60, -40, 40),
      allOk(3),
    )

    expect(views[1]?.legendName).toBe(`市电（${SLICE_NOTES.negative}）`)
    expect(views[1]?.value).toBeNull()
    expect(views.map((view) => view.share)).toEqual([60, null, 40])
  })

  it('没下发逐槽结论时按「有没有值」判，设计态因此照画', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: THREE },
      readings(10, undefined, 30),
    )

    expect(views.map((view) => view.index)).toEqual([0, 2])
    expect(views.map((view) => view.state)).toEqual(['ok', 'ok'])
  })
})

describe('占比', () => {
  it('分母只算当前可画的那几片', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: THREE },
      readings(30, 10, undefined),
      {
        [sliceFieldKey(0)]: { state: 'ok' },
        [sliceFieldKey(1)]: { state: 'ok' },
        [sliceFieldKey(2)]: { state: 'pending' },
      },
    )

    expect(views.map((view) => view.share)).toEqual([75, 25, null])
    expect(views.map((view) => view.shareText)).toEqual(['75%', '25%', ''])
  })

  it('全是 0 时算不出占比，也不伪造一个平均数', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: [THREE[0], THREE[1]] },
      readings(0, 0),
      allOk(2),
    )

    expect(views.map((view) => view.share)).toEqual([null, null])
    expect(views.map((view) => view.value)).toEqual([0, 0])
  })
})

describe('文案', () => {
  it('逐片的单位与小数位压过整块那一份', () => {
    const views = build(
      {
        unit: 'kWh',
        precision: 0,
        [SLICE_ITEMS_KEY]: [
          { name: '光伏' },
          { name: '水耗', unit: 't', precision: 2 },
        ],
      },
      readings(420.6, 3.145),
      allOk(2),
    )

    expect(views.map((view) => view.text)).toEqual(['421kWh', '3.15t'])
  })

  it('没起名的那几片按「第 N 片」称呼，重名的按出现序去重', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: [{}, { name: '光伏' }, { name: '光伏' }] },
      readings(1, 2, 3),
      allOk(3),
    )

    expect(views.map((view) => view.legendName)).toEqual([
      '第 1 片',
      '光伏',
      '光伏#1',
    ])
  })

  it('画不出来的那几片读数是空串，不留一个「—」冒充读数', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: [THREE[0]] },
      readings(undefined),
      {
        [sliceFieldKey(0)]: { state: 'pending' },
      },
    )

    expect(views[0]?.text).toBe('')
  })
})

describe('派生出去的那几样', () => {
  it('签名含状态与读数，值一变它就变', () => {
    const config = { [SLICE_ITEMS_KEY]: [THREE[0]] }
    const before = signatureOf(build(config, readings(10), allOk(1)))
    const after = signatureOf(build(config, readings(11), allOk(1)))

    expect(before).not.toBe(after)
    expect(signatureOf(build(config, readings(10), allOk(1)))).toBe(before)
  })

  it('读屏摘要逐片报名字、读数与占比', () => {
    const summary = ariaSummaryOf(
      build(
        { [SLICE_ITEMS_KEY]: [THREE[0], THREE[1]] },
        readings(75, 25),
        allOk(2),
      ),
    )

    expect(summary).toContain('共 2 片')
    expect(summary).toContain('光伏 75')
    expect(summary).toContain('占比 75%')
  })

  it('一片都没配来源时读屏摘要给空串，壳据此省掉整个属性', () => {
    expect(ariaSummaryOf([])).toBe('')
  })

  it('没读数的那几片也报进读屏摘要：图例关得掉，读屏这一面关不掉', () => {
    const summary = ariaSummaryOf(
      build({ [SLICE_ITEMS_KEY]: THREE }, readings(75, 25, 1), {
        [sliceFieldKey(0)]: { state: 'ok' },
        [sliceFieldKey(1)]: { state: 'ok' },
        [sliceFieldKey(2)]: { state: 'error' },
      }),
    )

    expect(summary).toContain('另有 1 片没有读数')
    expect(summary).toContain(`储能（${SLICE_NOTES.error}）`)
  })

  it('一片都画不出来但配了来源时也报一句，不留一个没名字的图形', () => {
    const summary = ariaSummaryOf(
      build({ [SLICE_ITEMS_KEY]: [THREE[0]] }, readings(1), {
        [sliceFieldKey(0)]: { state: 'pending' },
      }),
    )

    expect(summary).toContain('一片都画不出来')
    expect(summary).toContain(SLICE_NOTES.pending)
  })

  it('点一片上抛的是配置里写的名称，不带去重后缀也不给占位名', () => {
    const views = build(
      { [SLICE_ITEMS_KEY]: [{}, { name: '光伏' }, { name: '光伏' }] },
      readings(1, 2, 3),
      allOk(3),
    )

    expect(views.map((view) => view.emitValue)).toEqual(['', '光伏', '光伏'])
  })
})

describe('空态口径', () => {
  it('一片都画不出来时出空态，文案可换、清空则回落', () => {
    const config = { [SLICE_ITEMS_KEY]: THREE, emptyText: '未接点位' }
    const views = build(config, readings(1, 2, 3), {
      [sliceFieldKey(0)]: { state: 'pending' },
      [sliceFieldKey(1)]: { state: 'error' },
      [sliceFieldKey(2)]: { state: 'pending' },
    })

    expect(emptyStateOf(config, views)).toEqual({
      isEmpty: true,
      text: '未接点位',
    })
    expect(emptyStateOf({ ...config, emptyText: '   ' }, views).text).toBe(
      PIE_EMPTY_TEXT,
    )
  })

  it('读数全是 0 时另说一句：有读数，但没有分母', () => {
    const config = { [SLICE_ITEMS_KEY]: THREE }
    const views = build(config, readings(0, 0), allOk(2))

    expect(emptyStateOf(config, views)).toEqual({
      isEmpty: true,
      text: PIE_ZERO_TEXT,
    })
  })

  it('接到一片就不算空，哪怕另外几片取不到', () => {
    const config = { [SLICE_ITEMS_KEY]: THREE }
    const views = build(config, readings(30, 1), {
      [sliceFieldKey(0)]: { state: 'ok' },
      [sliceFieldKey(1)]: { state: 'error' },
    })

    expect(emptyStateOf(config, views)).toEqual({ isEmpty: false, text: '' })
  })

  it('算不出占比时摘要只报读数', () => {
    const summary = ariaSummaryOf(
      build({ [SLICE_ITEMS_KEY]: [THREE[0]] }, readings(0), allOk(1)),
    )

    expect(summary).toContain('光伏 0')
    expect(summary).not.toContain('占比')
  })

  it('绑点面板逐行拿得到名字与核对用的标识', () => {
    expect(
      sliceRowLabels({ [SLICE_ITEMS_KEY]: [{}, { name: '市电' }] }),
    ).toEqual({
      [sliceFieldKey(0)]: { title: '第 1 片', id: '' },
      [sliceFieldKey(1)]: { title: '市电', id: '市电' },
    })
  })

  it('一片都没有时行数也给 0，不许把键漏掉', () => {
    expect(sliceRowCounts({})).toEqual({ [SLICE_SLOT_KEY]: 0 })
    expect(sliceRowCounts({ [SLICE_ITEMS_KEY]: THREE })).toEqual({
      [SLICE_SLOT_KEY]: 3,
    })
  })

  it('空态兜底文案是一句现成的话', () => {
    expect(PIE_EMPTY_TEXT.length).toBeGreaterThan(0)
  })
})
