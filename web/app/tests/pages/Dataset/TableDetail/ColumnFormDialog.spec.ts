/**
 * @fileoverview 列表单弹窗的契约：打开即铺好现值、标识建后锁死、来源切换换掉
 * 下面整块、校验挡在提交前、标识被占用要落到那一格上。
 *
 * ⚠ 「打开即铺好现值」这条最容易破：watch 不写 immediate 时，组件在已经是
 * 打开态时被挂载，表单会是空的，而看上去只是「用户自己没填」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetColumn, DatasetFormulaValidation } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as dataset from '@/api/dataset'
import ColumnFormDialog from '@/pages/Dataset/TableDetail/components/ColumnFormDialog.vue'
import { VALIDATE_DEBOUNCE_MS } from '@/pages/Dataset/TableDetail/scripts/useFormulaValidation'

const STAMP = '2026-01-01T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'kwh',
    name: '用电量',
    unit: 'kWh',
    decimals: 2,
    data_type: 'number',
    source: 'point',
    agg: 'delta',
    node_key: 'src1:meter.kwh',
    formula: null,
    formula_deps: null,
    order_index: 1,
    is_required: false,
    default_value: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

const CATALOG = {
  categories: [],
  functions: [],
  operators: [],
  window_units: [],
  rules: [],
  columns: [],
  tables: [],
  library: [],
}

function validation(over: Partial<DatasetFormulaValidation> = {}) {
  return {
    is_ok: true,
    error: null,
    deps: {
      same_row: [],
      prev: [],
      window: [],
      whole: [],
      external: [],
      referenced_keys: [],
    },
    notation: null,
    notation_text: '甲 + 乙',
    ...over,
  } satisfies DatasetFormulaValidation
}

beforeEach(() => {
  vi.spyOn(dataset, 'createDatasetColumn').mockResolvedValue(column())
  vi.spyOn(dataset, 'updateDatasetColumn').mockResolvedValue(column())
  vi.spyOn(dataset, 'getDatasetFormulaCatalog').mockResolvedValue(CATALOG)
  vi.spyOn(dataset, 'validateDatasetFormula').mockResolvedValue(validation())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open(target: DatasetColumn | null) {
  const wrapper = mount(ColumnFormDialog, {
    props: { modelValue: true, tableId: 't1', column: target },
  })
  await flushPromises()
  return wrapper
}

function inputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.dt-input__el')]
}

async function type(index: number, value: string): Promise<void> {
  const field = inputs()[index]
  if (field === undefined) throw new Error(`第 ${index} 个输入框不存在`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

/** 点弹窗底部文案恰好等于这几个字的那个按钮。 */
async function click(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  )
  button?.click()
  await flushPromises()
}

describe('打开即铺好现值', () => {
  it('编辑态每一格都是库里的现值', async () => {
    await open(column())
    expect(inputs()[0]?.value).toBe('用电量')
    expect(inputs()[1]?.value).toBe('kwh')
    expect(inputs().map((one) => one.value)).toContain('src1:meter.kwh')
  })

  it('⚠ 编辑态的列标识是禁用的：改一次历史值就集体失联', async () => {
    await open(column())
    expect(inputs()[1]?.disabled).toBe(true)
    expect(document.body.textContent).toContain('建后不可改')
  })

  it('新增态标识可填，且没手打过时跟着名称走', async () => {
    await open(null)
    expect(inputs()[1]?.disabled).toBe(false)
    await type(0, '进水量')
    expect(inputs()[1]?.value).toBe('进水量')
  })

  it('手打过标识之后就再也不被名称覆盖', async () => {
    await open(null)
    await type(1, 'my_key')
    await type(0, '进水量')
    expect(inputs()[1]?.value).toBe('my_key')
  })
})

describe('三选一的来源子块', () => {
  it('人工录入摆默认值与必填', async () => {
    await open(column({ source: 'manual' }))
    expect(document.body.textContent).toContain('默认值')
    expect(document.body.textContent).toContain('必填')
  })

  it('点位汇总摆点位标识与聚合口径，且口径带一句怎么算的说明', async () => {
    await open(column())
    expect(document.body.textContent).toContain('点位标识')
    expect(document.body.textContent).toContain('聚合口径')
    expect(document.body.textContent).toContain('上一周期末值')
  })

  it('公式这一档挂的是编辑器：工具箱与两种编辑面都在', async () => {
    await open(column({ source: 'formula', formula: '{a}+{b}' }))
    expect(document.body.textContent).toContain('本表的列')
    expect(document.body.textContent).toContain('分段')
  })
})

describe('公式没校验通过就不放行保存', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /** 走完校验的防抖与在飞的那一次。 */
  async function settleCheck(): Promise<void> {
    await vi.advanceTimersByTimeAsync(VALIDATE_DEBOUNCE_MS)
    await flushPromises()
  }

  function saveButton(): HTMLButtonElement | undefined {
    return [...document.querySelectorAll('button')].find(
      (one) => one.textContent?.trim() === '保存',
    )
  }

  it('⚠ 结论还没回来时保存是禁用的：不然点完保存才在后端撞上「公式写不通」', async () => {
    await open(column({ source: 'formula', formula: '{a}+{b}' }))
    expect(saveButton()?.disabled).toBe(true)
  })

  it('校验通过就放行', async () => {
    await open(column({ source: 'formula', formula: '{a}+{b}' }))
    await settleCheck()
    expect(saveButton()?.disabled).toBe(false)
  })

  it('后端说公式写不通就一直拦着', async () => {
    vi.mocked(dataset.validateDatasetFormula).mockResolvedValue(
      validation({ is_ok: false, error: '少了一个右括号', deps: null }),
    )
    await open(column({ source: 'formula', formula: '{a}+' }))
    await settleCheck()
    expect(saveButton()?.disabled).toBe(true)
    expect(document.body.textContent).toContain('少了一个右括号')
  })

  it('⚠ 别的来源不受这条拦：那一档根本没有公式可校验', async () => {
    await open(column({ source: 'manual' }))
    expect(saveButton()?.disabled).toBe(false)
  })
})

describe('校验挡在提交前', () => {
  it('名称空着点保存不发请求，且那一格给出错误文案', async () => {
    await open(null)
    await click('保存')
    expect(dataset.createDatasetColumn).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填列名称')
  })

  it('点位列没填点位标识时同样挡住', async () => {
    await open(column({ node_key: '' }))
    await click('保存')
    expect(dataset.updateDatasetColumn).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填点位标识')
  })
})

describe('保存', () => {
  it('新增走建列端点，报出的那一句带上刚建的列名', async () => {
    const wrapper = await open(null)
    await type(0, '进水量')
    await click('保存')
    expect(dataset.createDatasetColumn).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ key: '进水量', name: '进水量' }),
    )
    expect(wrapper.emitted('saved')?.[0]?.[0]).toContain('用电量')
  })

  it('编辑走改列端点，且补丁里没有 key', async () => {
    await open(column())
    await click('保存')
    const patch = vi.mocked(dataset.updateDatasetColumn).mock.calls[0]?.[2]
    expect(Object.keys(patch ?? {})).not.toContain('key')
  })

  it('⚠ 标识被占用是一句指向某一格的话，不该弹成通用失败', async () => {
    vi.mocked(dataset.createDatasetColumn).mockRejectedValueOnce(
      new BizError(
        ERROR_CODES.datasetColumnKeyTaken,
        '列标识已存在',
        409,
        'trace',
      ),
    )
    await open(null)
    await type(0, '进水量')
    await click('保存')
    expect(document.body.textContent).toContain('已经有这个列标识了')
  })

  it('别的失败走通用提示，弹窗不关', async () => {
    vi.mocked(dataset.createDatasetColumn).mockRejectedValueOnce(
      new BizError(ERROR_CODES.validationFailed, '公式写不通', 400, 'trace'),
    )
    const wrapper = await open(null)
    await type(0, '进水量')
    await click('保存')
    expect(document.body.textContent).toContain('公式写不通')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
