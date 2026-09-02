/**
 * @fileoverview 参数面板的三件小事：一句话结果、时刻写法、恢复默认与必填。
 */
import { describe, expect, it } from 'vitest'

import type { FormField } from '@/pages/Modeling/Canvas/scripts/schemaForm'
import {
  isDefault,
  missingHint,
} from '@/pages/Modeling/Canvas/scripts/schemaForm'
import { headlineOf } from '@/pages/Modeling/Canvas/scripts/nodeHeadline'
import {
  RELATIVE_PRESETS,
  isRelative,
  modeOf,
  seedFor,
} from '@/pages/Modeling/Canvas/scripts/moment'

function field(over: Partial<FormField> = {}): FormField {
  return {
    key: 'k',
    label: '标签',
    hint: '',
    widget: 'text',
    isRequired: false,
    options: [],
    min: null,
    max: null,
    fallback: undefined,
    ...over,
  }
}

describe('卡片上那行结果', () => {
  it('帧给行列数，行数带千分位', () => {
    expect(
      headlineOf({
        kind: 'frame',
        rowCount: 12000,
        colCount: 8,
        columns: [],
        indexName: '',
        indexHead: [],
        head: [],
        isRowsTruncated: false,
        isColsTruncated: false,
        provenance: {
          tableCodes: [],
          since: null,
          until: null,
          isTruncated: false,
        },
      }),
    ).toBe('12,000 行 × 8 列')
  })

  it('模型给特征个数', () => {
    expect(
      headlineOf({
        kind: 'model',
        algo: 'linear_regression',
        task: 'regression',
        featureKeys: ['a', 'b'],
        targetKey: 'y',
        hyperParams: [],
        isFitted: true,
        isFittedTrimmed: false,
        coefficients: [],
        intercept: null,
        servingChannel: 'json',
      }),
    ).toBe('2 个特征')
  })

  it('指标最多印两个，按固定顺序取', () => {
    expect(
      headlineOf({
        kind: 'metrics',
        task: 'regression',
        metrics: [
          ['mae', 1],
          ['rmse', 2],
          ['r2', 0.93],
        ],
        pairs: [],
        isPairsTruncated: false,
        residualBins: [],
      }),
    ).toBe('R² 0.93 · RMSE 2')
  })

  it('认不出的结果不占那一行', () => {
    expect(headlineOf({ kind: 'unknown', note: '没有摘要' })).toBe('')
  })
})

describe('时刻的三种写法', () => {
  it('留空、相对、绝对分得清', () => {
    expect(modeOf('')).toBe('blank')
    expect(modeOf('  ')).toBe('blank')
    expect(modeOf('-90d')).toBe('relative')
    expect(modeOf('2026-01-01T00:00:00Z')).toBe('absolute')
  })

  it('相对写法认单位，写歪了当场判不合法', () => {
    expect(isRelative('-12h')).toBe(true)
    expect(isRelative('-3mo')).toBe(true)
    expect(isRelative('90d')).toBe(false)
    expect(isRelative('-90')).toBe(false)
  })

  it('换成相对时给一个能用的初值，另两种给空', () => {
    expect(seedFor('relative')).toBe('-90d')
    expect(seedFor('absolute')).toBe('')
    expect(seedFor('blank')).toBe('')
  })

  it('常用档全是合法的相对写法', () => {
    for (const preset of RELATIVE_PRESETS) {
      expect(isRelative(preset.value)).toBe(true)
    }
  })
})

describe('恢复默认与必填', () => {
  it('值与默认一致时不给「恢复默认」', () => {
    expect(isDefault(field({ fallback: 20 }), 20)).toBe(true)
    expect(isDefault(field({ fallback: 20 }), 30)).toBe(false)
  })

  it('数组按内容比，不按引用比', () => {
    expect(isDefault(field({ fallback: [] }), [])).toBe(true)
    expect(isDefault(field({ fallback: [] }), ['a'])).toBe(false)
  })

  it('必填且没有默认值时，空着要说出来', () => {
    const required = field({ isRequired: true })

    expect(missingHint(required, '')).toContain('必须')
    expect(missingHint(required, [])).toContain('必须')
    expect(missingHint(required, 'x')).toBe('')
  })

  // ⚠ 有默认值的字段留空是合法的，运行时按默认走
  it('有默认值的必填项留空不报错', () => {
    expect(missingHint(field({ isRequired: true, fallback: 'x' }), '')).toBe('')
  })

  it('非必填项留空不报错', () => {
    expect(missingHint(field(), '')).toBe('')
  })
})

describe('无定义的指标不往卡片上印', () => {
  it('null 的那个跳过，接着取下一个', () => {
    expect(
      headlineOf({
        kind: 'metrics',
        task: 'regression',
        metrics: [
          ['r2', null],
          ['rmse', 2],
          ['mae', 1],
        ],
        pairs: [],
        isPairsTruncated: false,
        residualBins: [],
      }),
    ).toBe('RMSE 2 · MAE 1')
  })
})
