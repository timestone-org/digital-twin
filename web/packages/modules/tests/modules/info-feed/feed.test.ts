/**
 * @fileoverview 守 info-feed 的行组装：直通渲染（不评估阈值、不格式化数值）、级别两侧归一、
 * 用户色板与内置档的合并口径、三槽全空的条目整条跳过、按级别排序时同权重稳定，
 * 以及「上抛的是原始正文而不是占位符」。
 * ⚠ 这几条错了都不报错：屏上只是多出一串空行、少一档颜色，或者联动被设成一个「—」。
 */
import { describe, expect, it } from 'vitest'

import {
  buildFeedRows,
  FEED_SLOT_FIELDS,
  FEED_SLOT_KEY,
  IF_ROW_VAR_NAMES,
  readFeedEmptyText,
  readFeedLevels,
  type FeedRowView,
} from '../../../src/modules/info-feed/feed'
import { NO_DATA } from '../../../src/shared/format'

/** 中国气象预警五色，作为**配置数据**填进 `levels`——代码里一个色值都没有。 */
const WEATHER_LEVELS = [
  { key: 'red', label: '红色', color: '#ff0000', rank: 5 },
  { key: 'orange', label: '橙色', color: '#ff8000', rank: 4 },
  { key: 'yellow', label: '黄色', color: '#ffe400', rank: 3 },
  { key: 'blue', label: '蓝色', color: '#00deff', rank: 2 },
  { key: 'green', label: '绿色', color: '#14e144', rank: 1 },
]

function rowsOf(
  rows: unknown,
  config: Record<string, unknown> = {},
): FeedRowView[] {
  return buildFeedRows({ config, rows })
}

function textsOf(rows: readonly FeedRowView[]): string[] {
  return rows.map((row) => row.text)
}

describe('槽键与子槽键', () => {
  it('槽键与三个子槽键都从这里取，清单不许各写一遍字面量', () => {
    expect(FEED_SLOT_KEY).toBe('feedValues')
    expect([...FEED_SLOT_FIELDS]).toEqual(['level', 'text', 'time'])
  })

  it('读侧认的就是这三个键——清单的 arrayFields 必须照这一份摆', () => {
    const pushed: Record<string, unknown> = {}
    for (const field of FEED_SLOT_FIELDS) {
      pushed[field] = field === 'level' ? 'danger' : field
    }

    expect(rowsOf([pushed])[0]).toMatchObject({
      level: 'danger',
      text: 'text',
      time: 'time',
    })
  })

  it('逐行变量只有级别色一个', () => {
    expect([...IF_ROW_VAR_NAMES]).toEqual(['--if-level-color'])
  })
})

describe('直通渲染', () => {
  it('三个子槽原样上墙，不评估阈值也不动数值格式', () => {
    const rows = rowsOf([
      { level: 'danger', text: '未来 3 小时降雨量 100mm', time: '10:24' },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      level: 'danger',
      label: '危险',
      text: '未来 3 小时降雨量 100mm',
      time: '10:24',
      rank: 4,
    })
  })

  it('时刻是后端推的成品文本，不是墙钟也不重排格式', () => {
    const rows = rowsOf([{ text: '巡检完成', time: '昨天 23:59' }])

    expect(rows[0]?.time).toBe('昨天 23:59')
  })

  it('级别两侧归一：大写与前后空格都吃得下', () => {
    const rows = rowsOf([
      { level: 'WARNING', text: '一' },
      { level: ' Red ', text: '二' },
    ])

    expect(rows.map((row) => row.level)).toEqual(['warning', 'red'])
    expect(rows.map((row) => row.label)).toEqual(['警告', '危险'])
  })

  it('认不出的级别不注入颜色、不编造文字，也不伪装成某一档状态', () => {
    const rows = rowsOf([{ level: 'purple', text: '一' }])

    expect(rows[0]).toMatchObject({ label: '', rank: 0 })
    expect(rows[0]?.vars).toEqual({})
  })

  it('认得出的级别把颜色摊成一个逐行变量', () => {
    expect(rowsOf([{ level: 'info', text: '一' }])[0]?.vars).toEqual({
      '--if-level-color': 'var(--state-info)',
    })
  })
})

describe('三槽全空的条目整条跳过', () => {
  it('刚加的行还没选点时是个空对象，画出来会是一串空白行', () => {
    const rows = rowsOf([
      {},
      { level: '', text: '   ', time: '' },
      { text: '真有一条' },
    ])

    expect(textsOf(rows)).toEqual(['真有一条'])
  })

  it('数组里的空洞与非对象条目一样跳过，不当成一行', () => {
    const sparse: unknown[] = []
    sparse[2] = { text: '第三条' }

    expect(textsOf(rowsOf(sparse))).toEqual(['第三条'])
    expect(rowsOf(['一句话', 42, null])).toEqual([])
  })

  it('不是数组的推送值一律当空，不抛也不猜', () => {
    expect(rowsOf(undefined)).toEqual([])
    expect(rowsOf({ level: 'danger' })).toEqual([])
  })

  it('只缺正文的条目照样上墙，正文位显缺值占位符', () => {
    const rows = rowsOf([{ level: 'warning', time: '09:10' }])

    expect(rows[0]?.text).toBe(NO_DATA)
  })
})

describe('上抛值与显示值分开', () => {
  it('上抛的是后端推的原始正文，不是屏上的占位符', () => {
    const rows = rowsOf([
      { text: ' 阵风 8 级 ' },
      { level: 'danger', time: '10:00' },
    ])

    expect(rows[0]).toMatchObject({ text: '阵风 8 级', pickValue: '阵风 8 级' })
    expect(rows[1]).toMatchObject({ text: NO_DATA, pickValue: '' })
  })
})

describe('行键', () => {
  it('位次加内容拼键，同一批里互不相撞', () => {
    const rows = rowsOf([{ text: '同一句' }, { text: '同一句' }])

    expect(new Set(rows.map((row) => row.key)).size).toBe(2)
    expect(rows[0]?.key).toContain('0')
  })

  it('按级别重排不改键——排序换的是次序，不是身份', () => {
    const items = [
      { level: 'info', text: '一' },
      { level: 'danger', text: '二' },
    ]
    const plain = rowsOf(items)
    const sorted = rowsOf(items, { sortByRank: true })

    expect(sorted.map((row) => row.key)).toEqual([plain[1]?.key, plain[0]?.key])
  })
})

describe('按级别排序', () => {
  it('缺省保持推送顺序，这是直通语义', () => {
    const rows = rowsOf([
      { level: 'info', text: '一' },
      { level: 'danger', text: '二' },
      { level: 'success', text: '三' },
    ])

    expect(textsOf(rows)).toEqual(['一', '二', '三'])
  })

  it('开了就按权重降序，危险在最前、正常在最后', () => {
    const rows = rowsOf(
      [
        { level: 'success', text: '正常' },
        { level: 'warning', text: '警告' },
        { level: 'danger', text: '危险' },
        { level: 'info', text: '提示' },
      ],
      { sortByRank: true },
    )

    expect(textsOf(rows)).toEqual(['危险', '警告', '提示', '正常'])
  })

  it('同权重按到达序，不许两次算出两种次序', () => {
    const items = [
      { level: 'red', text: '一' },
      { level: 'danger', text: '二' },
      { level: 'error', text: '三' },
    ]

    expect(textsOf(rowsOf(items, { sortByRank: true }))).toEqual([
      '一',
      '二',
      '三',
    ])
    expect(textsOf(rowsOf(items, { sortByRank: true }))).toEqual([
      '一',
      '二',
      '三',
    ])
  })

  it('认不出的级别排在正常之下，而不是与正常并列', () => {
    const rows = rowsOf(
      [
        { level: 'purple', text: '认不出' },
        { level: 'success', text: '正常' },
      ],
      { sortByRank: true },
    )

    expect(textsOf(rows)).toEqual(['正常', '认不出'])
  })

  it('跳过的空条目不占位次，同权重的先后仍按真实到达序', () => {
    const rows = rowsOf(
      [{ level: 'danger', text: '一' }, {}, { level: 'danger', text: '二' }],
      { sortByRank: true },
    )

    expect(textsOf(rows)).toEqual(['一', '二'])
  })
})

describe('用户色板与内置档合并', () => {
  it('没配色板时就是内置的 11 档，一档不多', () => {
    expect(Object.keys(readFeedLevels({}))).toHaveLength(11)
    expect(Object.keys(readFeedLevels({ levels: 'x' })).sort()).toEqual(
      Object.keys(readFeedLevels({})).sort(),
    )
    expect(readFeedLevels({}).danger?.label).toBe('危险')
  })

  it('只填颜色的条目仍回落内置的文字与权重——配了一半不该把另一半打回中性', () => {
    const table = readFeedLevels({
      levels: [{ key: 'red', color: 'var(--accent-primary)' }],
    })

    expect(table.red).toEqual({
      color: 'var(--accent-primary)',
      label: '危险',
      rank: 4,
    })
  })

  it('只改文字或只改权重时，颜色仍是那一档主题色', () => {
    const table = readFeedLevels({
      levels: [
        { key: 'warning', label: '注意' },
        { key: 'info', rank: 9 },
      ],
    })

    expect(table.warning).toEqual({
      color: 'var(--state-warning)',
      label: '注意',
      rank: 3,
    })
    expect(table.info).toEqual({
      color: 'var(--state-info)',
      label: '提示',
      rank: 9,
    })
  })

  it('同一个键配了两次，后配的覆盖先配的', () => {
    const table = readFeedLevels({
      levels: [
        { key: 'red', label: '先' },
        { key: 'red', label: '后' },
      ],
    })

    expect(table.red?.label).toBe('后')
  })

  it('键留空的条目直接丢掉，不会占掉查找表里的空串位', () => {
    const table = readFeedLevels({
      levels: [{ key: '  ', color: 'var(--state-danger)' }, 7],
    })

    expect(Object.keys(table)).toHaveLength(11)
    expect(table['']).toBeUndefined()
  })

  it('色板里的键同样归一，配置侧写大写照样能命中', () => {
    const table = readFeedLevels({ levels: [{ key: ' YELLOW ', rank: 8 }] })

    expect(table.yellow?.rank).toBe(8)
  })

  it('气象五色作为配置数据填进来，橙色因此有了自己的一档', () => {
    const rows = rowsOf(
      [
        { level: 'orange', text: '大风橙色预警' },
        { level: 'yellow', text: '大风黄色预警' },
      ],
      { levels: WEATHER_LEVELS, sortByRank: true },
    )

    expect(rows[0]).toMatchObject({ label: '橙色', rank: 4 })
    expect(rows[0]?.vars).toEqual({ '--if-level-color': '#ff8000' })
    expect(rows[1]?.vars).toEqual({ '--if-level-color': '#ffe400' })
  })

  it('五色齐了之后排序按气象口径走，橙压在黄之上', () => {
    const rows = rowsOf(
      WEATHER_LEVELS.map((level) => ({ level: level.key, text: level.label })),
      { levels: WEATHER_LEVELS, sortByRank: true },
    )

    expect(textsOf(rows)).toEqual(['红色', '橙色', '黄色', '蓝色', '绿色'])
  })

  it('色板里的新键没填颜色时不注入变量，只是多了一个文字标记', () => {
    const rows = rowsOf([{ level: 'orange', text: '一' }], {
      levels: [{ key: 'orange', label: '橙色' }],
    })

    expect(rows[0]?.label).toBe('橙色')
    expect(rows[0]?.vars).toEqual({})
  })
})

describe('空态文案', () => {
  it('没配或只填了空白时给通用文案——本模块也用于公告与日志', () => {
    expect(readFeedEmptyText({})).toBe('暂无信息')
    expect(readFeedEmptyText({ emptyText: '   ' })).toBe('暂无信息')
    expect(readFeedEmptyText({ emptyText: 42 })).toBe('暂无信息')
  })

  it('配了就用配的那一句', () => {
    expect(readFeedEmptyText({ emptyText: ' 暂无预警 ' })).toBe('暂无预警')
  })
})
