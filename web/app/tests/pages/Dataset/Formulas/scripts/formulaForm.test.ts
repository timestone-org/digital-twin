/**
 * @fileoverview 公式表单的纯逻辑：草稿回填、形参默认值的读写、校验与出参组装。
 *
 * ⚠ 默认值那一格最容易踩：一律当字符串收，数字型默认值就**永远存不下来**，
 * 而报错指向的是 PREV 不是那一格（docs/DATASET_DESIGN.md §5.11）。
 */
import { describe, expect, it } from 'vitest'
import type { DatasetFormulaDef, DatasetFormulaParam } from '@dt/contracts'

import {
  blankParam,
  formStateOf,
  hasError,
  isSemanticChange,
  lacksDefault,
  paramDefaultText,
  parseParamDefault,
  toCreateInput,
  toParamKind,
  toPatchInput,
  validateFormulaForm,
  type FormulaFormState,
} from '@/pages/Dataset/Formulas/scripts/formulaForm'

const STAMP = '2026-01-01T00:00:00.000Z'

function param(over: Partial<DatasetFormulaParam> = {}): DatasetFormulaParam {
  return {
    name: '本期',
    kind: 'column',
    label: '',
    hint: '',
    default: null,
    ...over,
  }
}

function def(over: Partial<DatasetFormulaDef> = {}): DatasetFormulaDef {
  return {
    id: 'f1',
    code: '折标煤',
    name: '折标煤',
    category: 'energy',
    expression: '{电耗} * 0.1229',
    params: [param({ name: '电耗' })],
    description: null,
    is_builtin: true,
    is_enabled: true,
    signature: '@折标煤(电耗)',
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

let seed = 0
const nextRowId = (): string => `p${(seed += 1)}`

function state(over: Partial<FormulaFormState> = {}): FormulaFormState {
  return {
    code: '折标煤',
    name: '折标煤',
    category: 'energy',
    expression: '{电耗} * 0.1229',
    description: '',
    params: [{ ...param({ name: '电耗' }), rowId: 'r1' }],
    ...over,
  }
}

describe('草稿回填', () => {
  it('新建时是空表单，分类落在默认档', () => {
    const draft = formStateOf(null, nextRowId)
    expect(draft.code).toBe('')
    expect(draft.category).toBe('custom')
    expect(draft.params).toEqual([])
  })

  it('编辑时铺好现值', () => {
    const draft = formStateOf(def(), nextRowId)
    expect(draft.code).toBe('折标煤')
    expect(draft.expression).toBe('{电耗} * 0.1229')
  })

  it('⚠ 形参逐项复制：改表单不该改到列表上那一行', () => {
    const source = def()
    const draft = formStateOf(source, nextRowId)
    const first = draft.params[0]
    if (first === undefined) throw new Error('形参没铺进来')
    first.name = '换了'
    expect(source.params[0]?.name).toBe('电耗')
  })

  it('⚠ 每一行都拿到一个 rowId：v-for 用索引做 key 会让删中间一行整体错位', () => {
    const draft = formStateOf(
      def({ params: [param(), param({ name: '上期' })] }),
      nextRowId,
    )
    const ids = draft.params.map((one) => one.rowId)
    expect(new Set(ids).size).toBe(2)
  })

  it('新加的空白行是列引用档', () => {
    expect(blankParam('r9').kind).toBe('column')
  })
})

describe('形参默认值那一格', () => {
  it("⚠ 纯数字进数字：当字符串收会渲成 PREV({x}, '12')，那一步永远校验不过", () => {
    expect(parseParamDefault('12')).toBe(12)
  })

  it('时间窗按字符串收，且不自己补引号——引号由后端补', () => {
    expect(parseParamDefault('24h')).toBe('24h')
    expect(parseParamDefault("'24h'")).toBe('24h')
  })

  it('留空即没有默认值，不是空串', () => {
    expect(parseParamDefault('  ')).toBeNull()
  })

  it('数字与文本都读得回那一格里', () => {
    expect(paramDefaultText(12)).toBe('12')
    expect(paramDefaultText('24h')).toBe('24h')
    expect(paramDefaultText(null)).toBe('')
  })

  it('⚠ 只有取值形参缺默认值才要提醒：列引用档本来就不填这一格', () => {
    expect(lacksDefault(param({ kind: 'value', default: null }))).toBe(true)
    expect(lacksDefault(param({ kind: 'value', default: 12 }))).toBe(false)
    expect(lacksDefault(param({ kind: 'column', default: null }))).toBe(false)
  })

  it('下拉抛回来的字符串窄化成档位，不认的给 undefined', () => {
    expect(toParamKind('value')).toBe('value')
    expect(toParamKind('analysis')).toBeUndefined()
  })
})

describe('本地校验', () => {
  it('名称与公式体空着时挡在提交前', () => {
    const found = validateFormulaForm(
      state({ name: ' ', expression: ' ' }),
      false,
    )
    expect(found.name).toBe('请填名称')
    expect(found.expression).toBe('请填公式体')
    expect(hasError(found)).toBe(true)
  })

  it('标识不合法时说清哪些字符不许用——后端的 pattern 就是这一条', () => {
    expect(
      validateFormulaForm(state({ code: '带 空格' }), false).code,
    ).not.toBe('')
    expect(validateFormulaForm(state({ code: 'a@b' }), false).code).not.toBe('')
  })

  it('⚠ 编辑态不校验标识：它建后不可改，那一格是锁死的', () => {
    expect(validateFormulaForm(state({ code: '带 空格' }), true).code).toBe('')
  })

  it('形参重名挡下来——后端展开时两处会共用一个位置', () => {
    const params = [
      { ...param({ name: '甲' }), rowId: 'r1' },
      { ...param({ name: '甲' }), rowId: 'r2' },
    ]
    expect(validateFormulaForm(state({ params }), false).params).toContain(
      '重复',
    )
  })

  it('形参没名字也挡下来', () => {
    const params = [{ ...param({ name: '  ' }), rowId: 'r1' }]
    expect(validateFormulaForm(state({ params }), false).params).not.toBe('')
  })

  it('形参超过 8 个挡下来——与后端 MAX_FX_PARAMS 同界', () => {
    const params = Array.from({ length: 9 }, (_, index) => ({
      ...param({ name: `p${index}` }),
      rowId: `r${index}`,
    }))
    expect(validateFormulaForm(state({ params }), false).params).toContain('8')
  })

  it('都填对时一条错都没有', () => {
    expect(hasError(validateFormulaForm(state(), false))).toBe(false)
  })
})

describe('出参组装', () => {
  it('新建带上标识，且 rowId 不进请求体', () => {
    const input = toCreateInput(state())
    expect(input.code).toBe('折标煤')
    expect(input.params[0]).toEqual(param({ name: '电耗' }))
  })

  it('说明留空提交的是 null 而不是空串——后端不收空串', () => {
    expect(toCreateInput(state({ description: '  ' })).description).toBeNull()
  })

  it('⚠ 补丁里没有 code，也没有 is_enabled：改口径与翻开关是两件事', () => {
    const patch = toPatchInput(state())
    expect(patch).not.toHaveProperty('code')
    expect(patch).not.toHaveProperty('is_enabled')
  })
})

describe('这次改动动没动口径', () => {
  it('改公式体算', () => {
    expect(
      isSemanticChange(def(), state({ expression: '{电耗} * 0.13' })),
    ).toBe(true)
  })

  it('改形参也算', () => {
    const params = [
      { ...param({ name: '电耗', kind: 'value', default: 1 }), rowId: 'r1' },
    ]
    expect(isSemanticChange(def(), state({ params }))).toBe(true)
  })

  it('⚠ 只改名称与分类不算：那时提「要重算」是一句假话', () => {
    expect(
      isSemanticChange(def(), state({ name: '折标准煤', category: 'basic' })),
    ).toBe(false)
  })
})
