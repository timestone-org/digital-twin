/**
 * @fileoverview 守多维雷达取值层的判据：逐轴四档状态、量程不可归一时整根轴留空
 * 而不是把读数夹成 0、没配来源的那几根整根不进输出、对比组是整条画或整条不画、
 * 空态那三句各自的触发条件，以及绑点面板上的行标题与行数。
 *
 * ⚠ 四档在注入袋里长得一模一样（键都不存在），全靠 `meta.slots` 分开。
 * ⚠ 「量程配错」与「取不到」必须是两句话：一件改配置、一件跑现场，合成一句就
 * 分不出该去哪儿修了。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  ariaSummaryOf,
  AXIS_ITEMS_KEY,
  AXIS_NOTES,
  axisFieldKey,
  axisRowCounts,
  axisRowLabels,
  buildAxisViews,
  buildCompareGroup,
  COMPARE_NOTES,
  drawnAxes,
  emptyStateOf,
  notedAxes,
  RADAR_EMPTY_TEXT,
  RADAR_TOO_FEW_TEXT,
  readGroupNames,
  signatureOf,
  type AxisView,
  type CompareGroup,
} from '../../../src/modules/radar-chart/axes'

type State = 'ok' | 'pending' | 'error'

const FOUR = [
  { name: '能效', min: 0, max: 100, unit: '分' },
  { name: '达标率', min: 0, max: 100, unit: '分' },
  { name: '健康度', min: 0, max: 100, unit: '分' },
  { name: '清洁度', min: 0, max: 100, unit: '分' },
]

/** 逐轴喂本组读数，缺省全部 ok；`states` 逐位覆盖本组那个子槽的档。 */
function viewsOf(
  config: Record<string, unknown>,
  own: readonly unknown[],
  opts: {
    compare?: readonly unknown[]
    states?: readonly State[]
    compareStates?: readonly State[]
  } = {},
): AxisView[] {
  const slots: Record<string, ModuleSlotMeta> = {}
  own.forEach((_, index) => {
    slots[axisFieldKey(index, 'value')] = {
      state: opts.states?.[index] ?? 'ok',
    }
  })
  opts.compare?.forEach((_, index) => {
    slots[axisFieldKey(index, 'compare')] = {
      state: opts.compareStates?.[index] ?? 'ok',
    }
  })
  return buildAxisViews({
    config,
    rows: own.map((value, index) => ({
      value,
      compare: opts.compare?.[index],
    })),
    slots,
  })
}

const BASE = { [AXIS_ITEMS_KEY]: FOUR }

/** 对比组逐轴配好的那几对，`[轴名, 读数]`。 */
function pairs(compare: CompareGroup): [string, number][] {
  return compare.readings.map((item) => [item.axis.name, item.value])
}

describe('逐轴状态', () => {
  it('本组那个子槽没配来源的整根轴不进输出，图例也不列它', () => {
    const views = buildAxisViews({
      config: BASE,
      rows: [{ value: 80 }, { value: 90 }],
      slots: { [axisFieldKey(0, 'value')]: { state: 'ok' } },
    })

    expect(views.map((view) => view.name)).toEqual(['能效'])
  })

  it('四档各说各的原因，不合并成一句「无数据」', () => {
    const views = viewsOf(BASE, [80, 90, 70, undefined], {
      states: ['ok', 'pending', 'error', 'ok'],
    })

    expect(views.map((view) => view.note)).toEqual([
      '',
      AXIS_NOTES.pending,
      AXIS_NOTES.error,
      AXIS_NOTES.missing,
    ])
    expect(views.map((view) => view.legendName)).toEqual([
      '能效',
      `达标率（${AXIS_NOTES.pending}）`,
      `健康度（${AXIS_NOTES.error}）`,
      `清洁度（${AXIS_NOTES.missing}）`,
    ])
  })

  it('画不出来的那几根轴读数一律给 null，绝不留一个会被画成凹陷的 0', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['ok', 'pending', 'error', 'ok'],
    })

    expect(views.map((view) => view.value)).toEqual([80, null, null, 60])
  })

  it('没起名的按「第 N 轴」称呼，同名的按出现序去重', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 0, max: 1 },
        { name: '能效', min: 0, max: 1 },
        { min: 0, max: 1 },
      ],
    }
    const views = viewsOf(config, [1, 1, 1])

    expect(views.map((view) => view.name)).toEqual([
      '能效',
      '能效#1',
      '第 3 轴',
    ])
  })

  it('注入袋里没有这一行时按无读数处理，不去读别的行', () => {
    const views = buildAxisViews({
      config: BASE,
      rows: [{ value: 80 }],
      slots: {
        [axisFieldKey(0, 'value')]: { state: 'ok' },
        [axisFieldKey(1, 'value')]: { state: 'ok' },
      },
    })

    expect(views.map((view) => view.note)).toEqual(['', AXIS_NOTES.missing])
  })

  it('没下发逐槽结论时按「有没有值」退档，设计态因此照画', () => {
    const views = buildAxisViews({
      config: BASE,
      rows: [{ value: 80 }, {}],
      slots: undefined,
    })

    expect(views.map((view) => view.name)).toEqual(['能效'])
    expect(drawnAxes(views).length).toBe(1)
  })
})

describe('逐轴量程', () => {
  it('量程填反的那根轴整根留空，而不是把读数夹成 0', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 100, max: 0 },
        { name: '达标率', min: 0, max: 100 },
      ],
    }
    const views = viewsOf(config, [50, 50])

    expect(views[0]?.note).toBe(AXIS_NOTES.badRange)
    expect(views[0]?.range).toBeNull()
    expect(views[0]?.value).toBeNull()
    expect(views[1]?.range).toEqual({ min: 0, max: 100 })
  })

  it('上下限相等也不可归一：整条轴的长度没有意义', () => {
    const config = { [AXIS_ITEMS_KEY]: [{ name: '能效', min: 5, max: 5 }] }

    expect(viewsOf(config, [5])[0]?.note).toBe(AXIS_NOTES.badRange)
  })

  it('量程没填出一个有限数时另说一句，跟填反了分开', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', max: 100 },
        { name: '达标率', min: 0, max: 'x' },
      ],
    }
    const views = viewsOf(config, [50, 50])

    expect(views.map((view) => view.note)).toEqual([
      AXIS_NOTES.noRange,
      AXIS_NOTES.noRange,
    ])
  })

  it('量程比状态先判：配置错自己不会好，等首帧再等一会儿就有了', () => {
    const config = { [AXIS_ITEMS_KEY]: [{ name: '能效', min: 100, max: 0 }] }
    const views = viewsOf(config, [50], { states: ['pending'] })

    expect(views[0]?.note).toBe(AXIS_NOTES.badRange)
  })

  it('量程是手编字符串时也认，配置面之外的脏值不至于让整根轴消失', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [{ name: '能效', min: '0', max: '100' }],
    }

    expect(viewsOf(config, [50])[0]?.range).toEqual({ min: 0, max: 100 })
  })
})

describe('对比组是整条画或整条不画', () => {
  it('一根轴的对比子槽都没绑时整条不进 option', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60])

    expect(buildCompareGroup(drawnAxes(views)).isConfigured).toBe(false)
  })

  it('每根画出来的轴上都有对比读数才画，顺序与轴逐位对齐', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
    })
    const compare = buildCompareGroup(drawnAxes(views))

    expect(compare.isConfigured).toBe(true)
    expect(compare.note).toBe('')
    // ⚠ 断言的是「哪根轴配了哪个数」：只比一串数字的话，少一项造成的整体错位照样绿
    expect(pairs(compare)).toEqual([
      ['能效', 70],
      ['达标率', 88],
      ['健康度', 76],
      ['清洁度', 61],
    ])
  })

  it('缺一根轴的对比读数就整条不画：多边形跳不过一个顶点', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      compare: [70, 88, undefined, 61],
      compareStates: ['ok', 'ok', 'ok', 'ok'],
    })
    const compare = buildCompareGroup(drawnAxes(views))

    expect(compare.note).toBe(COMPARE_NOTES.missing)
    expect(compare.readings).toEqual([])
  })

  it('原因取最该先看的那一条：取不到 > 等首帧 > 缺读数', () => {
    const both = viewsOf(BASE, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
      compareStates: ['pending', 'error', 'ok', 'ok'],
    })
    const waiting = viewsOf(BASE, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
      compareStates: ['pending', 'ok', 'ok', 'ok'],
    })

    expect(buildCompareGroup(drawnAxes(both)).note).toBe(COMPARE_NOTES.error)
    expect(buildCompareGroup(drawnAxes(waiting)).note).toBe(
      COMPARE_NOTES.pending,
    )
  })

  it('被剔出轮子的那根轴上的对比读数不参与判定', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 0, max: 100 },
        { name: '达标率', min: 0, max: 100 },
        { name: '健康度', min: 0, max: 100 },
        { name: '清洁度', min: 100, max: 0 },
      ],
    }
    const views = viewsOf(config, [80, 90, 70, 60], {
      compare: [70, 88, 76, undefined],
    })
    const compare = buildCompareGroup(drawnAxes(views))

    expect(compare.note).toBe('')
    expect(pairs(compare)).toEqual([
      ['能效', 70],
      ['达标率', 88],
      ['健康度', 76],
    ])
  })

  it('一根画得出来的轴都没有时对比组也无从谈起', () => {
    expect(buildCompareGroup([]).isConfigured).toBe(false)
  })
})

describe('空态那三句', () => {
  it('一根轴都没绑时用用户配的那句', () => {
    expect(emptyStateOf({ emptyText: '未接点位' }, [])).toEqual({
      isEmpty: true,
      text: '未接点位',
    })
  })

  it('空态文案被清空时回落一句现成的话，不留一条空白', () => {
    expect(emptyStateOf({ emptyText: '   ' }, []).text).toBe(RADAR_EMPTY_TEXT)
  })

  it('绑了但指标配得太少时另说一句，跟「没接」分开', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 0, max: 1 },
        { name: '达标率', min: 0, max: 1 },
      ],
    }
    const views = viewsOf(config, [1, 1])

    expect(emptyStateOf({ ...config, emptyText: '未接点位' }, views)).toEqual({
      isEmpty: true,
      text: RADAR_TOO_FEW_TEXT,
    })
  })

  it('有轴画不出来时把原因逐根挂在后面：不然不知道该修哪一根', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 100, max: 0 },
        { name: '达标率', min: 0, max: 100 },
        { name: '健康度', min: 0, max: 100 },
      ],
    }
    const views = viewsOf(config, [1, 1, 1], {
      states: ['ok', 'error', 'ok'],
    })

    expect(emptyStateOf(config, views).text).toBe(
      `${RADAR_TOO_FEW_TEXT}：能效（${AXIS_NOTES.badRange}）；达标率（${AXIS_NOTES.error}）`,
    )
  })

  it('画得出三根就不是空态，剩下几根接不上不算', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['ok', 'ok', 'ok', 'error'],
    })

    expect(emptyStateOf(BASE, views)).toEqual({ isEmpty: false, text: '' })
    expect(notedAxes(views).map((view) => view.name)).toEqual(['清洁度'])
  })
})

describe('两组的称呼', () => {
  it('留空回落到出厂称呼：空名字认领不到任何图例项', () => {
    expect(readGroupNames({ seriesName: '  ', compareName: '' })).toEqual({
      series: '本组',
      compare: '对比组',
    })
  })

  it('配了就用配的', () => {
    expect(
      readGroupNames({ seriesName: '本月', compareName: '去年同期' }),
    ).toEqual({ series: '本月', compare: '去年同期' })
  })
})

describe('签名与读屏摘要', () => {
  it('本组或对比组任一个读数变了签名就变', () => {
    const before = signatureOf(viewsOf(BASE, [80, 90, 70, 60]))
    const own = signatureOf(viewsOf(BASE, [81, 90, 70, 60]))
    const other = signatureOf(
      viewsOf(BASE, [80, 90, 70, 60], { compare: [1, 2, 3, 4] }),
    )

    expect(own).not.toBe(before)
    expect(other).not.toBe(before)
  })

  it('一根轴都没配来源时摘要给空串，壳据此把整个属性省掉', () => {
    expect(ariaSummaryOf(BASE, [])).toBe('')
  })

  it('摘要逐轴报本组读数，再报对比组，最后报画不出来的那几根', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '能效', min: 0, max: 100, unit: '分', precision: 0 },
        { name: '达标率', min: 0, max: 100, unit: '分', precision: 0 },
        { name: '健康度', min: 0, max: 100, unit: '分', precision: 0 },
        { name: '清洁度', min: 100, max: 0 },
      ],
    }
    const views = viewsOf(config, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
    })

    expect(ariaSummaryOf(config, views)).toBe(
      '多维雷达，本组共 3 根轴：能效 80分；达标率 90分；健康度 70分' +
        '；对比组：能效 70分；达标率 88分；健康度 76分' +
        `；另有 1 根轴画不出来：清洁度（${AXIS_NOTES.badRange}）`,
    )
  })

  it('对比组画不全时摘要只说原因，不编一组读数出来', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      compare: [70, 88, 76, 61],
      compareStates: ['error', 'ok', 'ok', 'ok'],
    })

    expect(ariaSummaryOf(BASE, views)).toContain(
      `对比组（${COMPARE_NOTES.error}）`,
    )
  })

  it('一根轴都画不出来时摘要照样把原因报出来：图例关得掉，读屏关不掉', () => {
    const views = viewsOf(BASE, [80, 90, 70, 60], {
      states: ['error', 'error', 'error', 'error'],
    })

    expect(ariaSummaryOf(BASE, views)).toBe(
      '多维雷达，一根轴都画不出来；另有 4 根轴画不出来：' +
        `能效（${AXIS_NOTES.error}）、达标率（${AXIS_NOTES.error}）、` +
        `健康度（${AXIS_NOTES.error}）、清洁度（${AXIS_NOTES.error}）`,
    )
  })

  it('逐轴单位与小数位优先，缺了才用整块那一份', () => {
    const config = {
      [AXIS_ITEMS_KEY]: [
        { name: '温度', min: 0, max: 100, unit: '℃', precision: 1 },
        { name: '压力', min: 0, max: 100 },
        { name: '流量', min: 0, max: 100 },
      ],
      unit: 'kPa',
      precision: 0,
    }

    expect(
      ariaSummaryOf(config, viewsOf(config, [12.345, 12.345, 1])),
    ).toContain('温度 12.3℃；压力 12kPa')
  })
})

describe('绑点面板上的行', () => {
  it('行标题跟着指标名走，键是这一行第一个子槽', () => {
    const config = { [AXIS_ITEMS_KEY]: [{ name: '能效' }, {}] }
    const labels = axisRowLabels(config)

    expect(labels[axisFieldKey(0, 'value')]).toEqual({
      title: '能效',
      id: '能效',
    })
    expect(labels[axisFieldKey(1, 'value')]?.title).toBe('第 2 轴')
    expect(labels[axisFieldKey(0, 'compare')]).toBeUndefined()
  })

  it('行数跟着指标走；一根都没有时也给 0，不许把键漏掉', () => {
    expect(axisRowCounts({ [AXIS_ITEMS_KEY]: FOUR })).toEqual({
      axisValues: 4,
    })
    expect(axisRowCounts({})).toEqual({ axisValues: 0 })
  })
})
