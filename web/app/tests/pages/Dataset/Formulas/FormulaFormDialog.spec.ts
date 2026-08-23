/**
 * @fileoverview 建 / 改库公式弹窗的契约。
 *
 * ⚠ 最要紧的一条是「保存键永远点得动」：参考实现把保存吊在一轮实时校验的结论
 * 上，而重开同一条公式时各字段被赋成完全相同的值 → 不触发校验 → 结论恒为空 →
 * 保存键永远灰着。本仓压根没有库公式的校验端点（公式体离开形参无法单独解析），
 * 保存的成败由那一次 400 说了算，这条用例就钉在这个差别上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  DatasetFormulaDef,
  DatasetFormulaDefWithUsages,
  DatasetFormulaParam,
  DatasetFormulaUsage,
} from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import { BizError } from '@/api/client'
import * as formulas from '@/api/datasetFormulas'
import FormulaFormDialog from '@/pages/Dataset/Formulas/components/FormulaFormDialog.vue'

const STAMP = '2026-01-01T00:00:00.000Z'

function param(over: Partial<DatasetFormulaParam> = {}): DatasetFormulaParam {
  return {
    name: '电耗',
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
    params: [param()],
    description: null,
    is_builtin: false,
    is_enabled: true,
    signature: '@折标煤(电耗)',
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function usage(over: Partial<DatasetFormulaUsage> = {}): DatasetFormulaUsage {
  return {
    table_id: 't1',
    table_code: 'energy',
    table_name: '能耗台账',
    column_id: 'c1',
    column_key: '标煤',
    column_name: '折标煤量',
    formula: '@折标煤({电耗})',
    is_direct: true,
    ...over,
  }
}

function withUsages(
  usages: DatasetFormulaUsage[] = [],
): DatasetFormulaDefWithUsages {
  return { ...def(), usages }
}

beforeEach(() => {
  vi.spyOn(formulas, 'createDatasetFormula').mockResolvedValue(def())
  vi.spyOn(formulas, 'updateDatasetFormula').mockResolvedValue(withUsages())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open(formula: DatasetFormulaDef | null) {
  const wrapper = mount(FormulaFormDialog, {
    props: { modelValue: true, formula },
  })
  await flushPromises()
  return wrapper
}

function inputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.dt-input__el')]
}

function textareas(): HTMLTextAreaElement[] {
  return [...document.querySelectorAll<HTMLTextAreaElement>('.dt-textarea__el')]
}

async function type(field: HTMLElement | undefined, value: string) {
  if (field === undefined) throw new Error('这一格不存在')
  Object.assign(field, { value })
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

function clickByText(text: string): void {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  )
  button?.click()
}

async function save(): Promise<void> {
  clickByText('保存')
  await flushPromises()
}

async function fillNew(): Promise<void> {
  await type(inputs()[0], '折标煤')
  await type(inputs()[1], '折标煤')
  await type(textareas()[0], '{电耗} * 0.1229')
}

describe('建 / 改库公式弹窗', () => {
  it('新建时是空表单', async () => {
    await open(null)
    expect(inputs()[0]?.value).toBe('')
    expect(inputs()[1]?.value).toBe('')
  })

  it('编辑时打开即铺好名称、标识与公式体', async () => {
    await open(def())
    expect(inputs()[0]?.value).toBe('折标煤')
    expect(inputs()[1]?.value).toBe('折标煤')
    expect(textareas()[0]?.value).toBe('{电耗} * 0.1229')
  })

  it('⚠ 编辑时标识锁死：它就是调用点上的字面量，改一次每处调用当场解析失败', async () => {
    await open(def())
    expect(inputs()[1]?.disabled).toBe(true)
    expect(document.body.textContent).toContain('建后不可改')
  })

  it('编辑时先把爆炸半径说在前面：改动即刻生效、历史行要重算', async () => {
    await open(def())
    expect(document.body.textContent).toContain(
      '改动即刻对所有引用它的台账列生效',
    )
  })

  it('⚠ 重开同一条、一个字不改，保存照样发得出去（保存键不吊在校验结论上）', async () => {
    const wrapper = await open(def())
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await save()
    expect(formulas.updateDatasetFormula).toHaveBeenCalledTimes(1)
  })

  it('建成之后的回执告诉人怎么调用它', async () => {
    const wrapper = await open(null)
    await fillNew()
    await save()
    expect(wrapper.emitted('saved')?.[0]?.[0]).toContain('@折标煤(…)')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('说明留空提交 null，且形参原样带上', async () => {
    await open(null)
    await fillNew()
    await save()
    expect(formulas.createDatasetFormula).toHaveBeenCalledWith(
      expect.objectContaining({ description: null, params: [] }),
    )
  })

  it('⚠ 改完口径的回执报出跟着走的列数与「要重算」', async () => {
    vi.mocked(formulas.updateDatasetFormula).mockResolvedValue(
      withUsages([usage(), usage({ column_id: 'c2', table_id: 't2' })]),
    )
    const wrapper = await open(def())
    await type(textareas()[0], '{电耗} * 0.13')
    await save()
    const message = String(wrapper.emitted('saved')?.[0]?.[0])
    expect(message).toContain('2 个台账列')
    expect(message).toContain('重算')
  })

  it('⚠ 只改名称时回执不提重算——历史行一个都没过期', async () => {
    vi.mocked(formulas.updateDatasetFormula).mockResolvedValue(
      withUsages([usage()]),
    )
    const wrapper = await open(def())
    await type(inputs()[0], '折标准煤')
    await save()
    expect(String(wrapper.emitted('saved')?.[0]?.[0])).not.toContain('重算')
  })

  it('标识被占用是一句指向那一格的话，且弹窗不关', async () => {
    vi.mocked(formulas.createDatasetFormula).mockRejectedValue(
      new BizError(
        ERROR_CODES.datasetFormulaCodeTaken,
        '公式标识已被占用：折标煤',
        409,
        'trace',
      ),
    )
    const wrapper = await open(null)
    await fillNew()
    await save()
    expect(document.body.textContent).toContain('这个标识已被占用')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('公式写不通时把后端那句话落在公式体那一格上', async () => {
    vi.mocked(formulas.createDatasetFormula).mockRejectedValue(
      new BizError(
        ERROR_CODES.datasetFormulaInvalid,
        '未知函数 FOO',
        400,
        'trace',
      ),
    )
    await open(null)
    await fillNew()
    await save()
    expect(document.body.textContent).toContain('未知函数 FOO')
  })

  it('⚠ 有取值形参时补一句「报错可能指错地方」——那句话说的是样例调用', async () => {
    vi.mocked(formulas.createDatasetFormula).mockRejectedValue(
      new BizError(
        ERROR_CODES.datasetFormulaInvalid,
        '时间窗必须是字符串字面量',
        400,
        'trace',
      ),
    )
    const wrapper = await open(null)
    await fillNew()
    clickByText('加一个')
    await flushPromises()
    wrapper
      .findAllComponents(DtSelect)[1]
      ?.vm.$emit('update:modelValue', 'value')
    await flushPromises()
    await type(inputs()[2], '窗口')
    await save()
    expect(document.body.textContent).toContain('时间窗必须是字符串字面量')
    expect(document.body.textContent).toContain('多半是某个取值形参没填默认值')
  })

  it('没有取值形参时不摆那句提示——它只会添乱', async () => {
    vi.mocked(formulas.createDatasetFormula).mockRejectedValue(
      new BizError(
        ERROR_CODES.datasetFormulaInvalid,
        '未知函数 FOO',
        400,
        'trace',
      ),
    )
    await open(null)
    await fillNew()
    await save()
    expect(document.body.textContent).not.toContain(
      '多半是某个取值形参没填默认值',
    )
  })

  it('其余失败照旧给一句原因，且弹窗不关', async () => {
    vi.mocked(formulas.createDatasetFormula).mockRejectedValue(
      new Error('boom'),
    )
    const wrapper = await open(null)
    await fillNew()
    await save()
    expect(document.body.textContent).toContain('请求失败')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('本地校验挡在提交前：名称空着不发请求', async () => {
    await open(null)
    await type(inputs()[1], '折标煤')
    await type(textareas()[0], '1')
    await save()
    expect(formulas.createDatasetFormula).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填名称')
  })
})

describe('形参表', () => {
  it('加一个之后多出一行，删掉之后回到没有形参', async () => {
    await open(null)
    clickByText('加一个')
    await flushPromises()
    expect(document.body.textContent).not.toContain('还没有形参')
    // ⚠ 弹窗 teleport 到 body 上，wrapper.find 找不到它里面的东西
    const remove = document.querySelector<HTMLButtonElement>(
      'button[aria-label^="删除形参"]',
    )
    remove?.click()
    await flushPromises()
    expect(document.body.textContent).toContain('还没有形参')
  })

  it('⚠ 切成取值档才出现默认值那一格，且当场说清它是干什么的', async () => {
    const wrapper = await open(null)
    clickByText('加一个')
    await flushPromises()
    const kind = wrapper.findAllComponents(DtSelect)[1]
    kind?.vm.$emit('update:modelValue', 'value')
    await flushPromises()
    expect(document.body.textContent).toContain('默认值必填')
  })

  it('⚠ 数字默认值以数字提交：当字符串收的话后端渲成带引号的字面量，永远存不下来', async () => {
    const wrapper = await open(null)
    await fillNew()
    clickByText('加一个')
    await flushPromises()
    const kind = wrapper.findAllComponents(DtSelect)[1]
    kind?.vm.$emit('update:modelValue', 'value')
    await flushPromises()
    await type(inputs()[2], '周期数')
    const slots = inputs()
    await type(slots[slots.length - 1], '12')
    await save()
    expect(formulas.createDatasetFormula).toHaveBeenCalledWith(
      expect.objectContaining({
        params: [
          { name: '周期数', kind: 'value', label: '', hint: '', default: 12 },
        ],
      }),
    )
  })
})
