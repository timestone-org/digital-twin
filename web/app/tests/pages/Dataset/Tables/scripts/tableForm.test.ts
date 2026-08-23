/**
 * @fileoverview 建表 / 改表表单的纯逻辑：编码建议、校验与出参组装。
 * 每一条都对着后端的一条 CHECK 约束——前端漏一条的表现是「点保存没反应」
 * 或一个指不到字段上的 422。
 */
import { describe, expect, it } from 'vitest'
import type { DatasetTableSummary } from '@dt/contracts'

import {
  CODE_MAX,
  emptyTableForm,
  formStateOf,
  suggestCode,
  toCreateInput,
  toPatchInput,
  validateTableForm,
  type TableFormState,
} from '@/pages/Dataset/Tables/scripts/tableForm'

const STAMP = '2026-01-01T00:00:00.000Z'

function filled(over: Partial<TableFormState> = {}): TableFormState {
  return { ...emptyTableForm(), code: 'energy', name: '能耗台账', ...over }
}

function table(over: Partial<DatasetTableSummary> = {}): DatasetTableSummary {
  return {
    id: 't1',
    code: 'energy_log',
    name: '能耗台账',
    description: null,
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: 90,
    last_collected_ts: null,
    is_enabled: false,
    column_count: 3,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

describe('编码建议', () => {
  it('把名称里的 ASCII 片段拼成合法编码', () => {
    expect(suggestCode('Energy Log 2026')).toBe('energy_log_2026')
  })

  it('⚠ 首尾的下划线要削掉：后端的 pattern 要求首字符是字母或数字', () => {
    expect(suggestCode('  一号机组 Energy  ')).toBe('energy')
  })

  it('⚠ 全中文推不出编码时就交回空串，不许胡乱兜一个', () => {
    // 兜出来的 `t_1` 会变成一堆没人认得出的大屏绑定键前半段
    expect(suggestCode('一号机组能耗台账')).toBe('')
  })

  it('不超过后端的长度上限', () => {
    expect(suggestCode('a'.repeat(200)).length).toBe(CODE_MAX)
  })
})

describe('校验', () => {
  it('填齐了就放行', () => {
    expect(validateTableForm(filled(), false)).toEqual({ code: '', name: '' })
  })

  it('名称只有空格等于没填', () => {
    expect(validateTableForm(filled({ name: '   ' }), false).name).not.toBe('')
  })

  it.each([['_bad'], ['有中文'], ['a b'], ['']])('编码 %s 不合法', (code) => {
    expect(validateTableForm(filled({ code }), false).code).not.toBe('')
  })

  it.each([['energy'], ['a.b-c_d'], ['9lives']])('编码 %s 合法', (code) => {
    expect(validateTableForm(filled({ code }), false).code).toBe('')
  })

  it('⚠ 编辑态不校验编码：那一格是禁用的，校验它只会挡住一次正常保存', () => {
    expect(validateTableForm(filled({ code: '' }), true).code).toBe('')
  })
})

describe('出参组装', () => {
  it('周期按秒填、按毫秒送', () => {
    const input = toCreateInput(filled({ intervalSeconds: 3600 }))
    expect(input.collect_interval_ms).toBe(3_600_000)
  })

  it('说明留空送 null 而不是空串', () => {
    expect(toCreateInput(filled()).description).toBeNull()
  })

  it('保留期留空送 null——0 天在后端是「立刻删光」，正好相反', () => {
    expect(toCreateInput(filled()).retention_days).toBeNull()
  })

  it('名称与编码两头的空格都削掉', () => {
    const input = toCreateInput(filled({ name: ' 能耗 ', code: ' energy ' }))
    expect([input.name, input.code]).toEqual(['能耗', 'energy'])
  })

  it('⚠ 改表的补丁里没有 code：改一次等于让每一处大屏绑定悄悄失效', () => {
    expect(toPatchInput(filled())).not.toHaveProperty('code')
  })
})

describe('把已有台账铺进表单', () => {
  it('null 即新建：给的是缺省表单', () => {
    expect(formStateOf(null)).toEqual(emptyTableForm())
  })

  it('毫秒换回秒，缺省值不覆盖已有取值', () => {
    const state = formStateOf(table())
    expect(state.intervalSeconds).toBe(3600)
    expect(state.retentionDays).toBe(90)
    expect(state.isEnabled).toBe(false)
  })

  it('⚠ 描述是 null 时铺成空串：输入框拿到 null 会显示成字面的 "null"', () => {
    expect(formStateOf(table()).description).toBe('')
  })

  it('永久保留铺成「没填」，而不是某个具体天数', () => {
    expect(
      formStateOf(table({ retention_days: null })).retentionDays,
    ).toBeUndefined()
  })
})
