/**
 * @fileoverview 公式编辑器的契约，重点是 §7.6 那三条时序规矩，每一条都对应一个
 * 真实的静默故障：
 *
 * ⚠ 分段面**只在切进去那一刻**播种一次——跟着每次校验回包重新播种的话，正在
 *   打字的那一格光标会被复位；
 * ⚠ 切回文本面**必须把选区重置到末尾**——旧下标指的是另一个字符串，不重置的话
 *   下一次工具箱插入会静默吃掉开头几个字符；
 * ⚠ 文本一变**立刻熄绿灯**——「改完了还亮着绿灯」是最骗人的状态。
 *
 * 另外两条：校验防抖 400ms 且慢的那次回来不许覆盖新结论；`is_ok=false` 是
 * 正常的编辑器状态，不是请求失败。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type {
  DatasetFormulaCatalog,
  DatasetFormulaValidation,
} from '@dt/contracts'

import * as dataset from '@/api/dataset'
import FormulaEditor from '@/pages/Dataset/TableDetail/components/FormulaEditor.vue'
import { VALIDATE_DEBOUNCE_MS } from '@/pages/Dataset/TableDetail/scripts/useFormulaValidation'

const CATALOG: DatasetFormulaCatalog = {
  categories: [{ value: 'math', label: '数学' }],
  functions: [
    {
      name: 'ABS',
      category: 'math',
      signature: 'ABS(x)',
      description: '绝对值',
      example: 'ABS({差值})',
      args: ['x'],
      min_args: 1,
      max_args: 1,
    },
  ],
  operators: [{ value: '+', label: '加' }],
  window_units: [{ value: '1h', label: '1 小时' }],
  rules: ['除数为 0 时结果为空'],
  columns: [
    {
      key: '进水量',
      name: '进水量',
      unit: 'm³',
      data_type: 'number',
      source: 'point',
    },
    {
      key: '出水量',
      name: '出水量',
      unit: 'm³',
      data_type: 'number',
      source: 'point',
    },
  ],
  tables: [],
  library: [],
}

function validation(over: Partial<DatasetFormulaValidation> = {}) {
  return {
    is_ok: true,
    error: null,
    deps: {
      same_row: ['进水量'],
      prev: [],
      window: [],
      whole: [],
      external: [],
      model: [],
      referenced_keys: ['进水量'],
    },
    notation: { t: 'col', name: '进水量', unit: 'm³', key: '进水量' },
    notation_text: '进水量',
    ...over,
  } satisfies DatasetFormulaValidation
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(dataset, 'getDatasetFormulaCatalog').mockResolvedValue(CATALOG)
  vi.spyOn(dataset, 'validateDatasetFormula').mockResolvedValue(validation())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function open(formula = '{进水量}') {
  const wrapper = mount(FormulaEditor, {
    props: { formula, tableId: 't1', columnKey: 'ratio', unit: 'm³' },
  })
  await settle()
  return wrapper
}

/** 走完防抖 + 在飞的那一次。 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(VALIDATE_DEBOUNCE_MS)
  await flushPromises()
}

type Editor = Awaited<ReturnType<typeof open>>

function textarea(wrapper: Editor) {
  return wrapper.get('textarea')
}

async function type(wrapper: Editor, value: string): Promise<void> {
  await textarea(wrapper).setValue(value)
  await flushPromises()
}

/** 点工具箱里那个以列名开头的小按钮（后面还跟着单位）。 */
async function clickChip(wrapper: Editor, text: string): Promise<void> {
  const chip = wrapper
    .findAll('button')
    .find((one) => one.text().trim().startsWith(text))
  if (chip === undefined) throw new Error(`工具箱里没有「${text}」`)
  await chip.trigger('click')
  await flushPromises()
}

/** 点文案恰好等于这几个字的那个按钮。 */
async function click(wrapper: Editor, text: string): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find((one) => one.text().trim() === text)
  if (button === undefined) throw new Error(`没有「${text}」这个按钮`)
  await button.trigger('click')
  await flushPromises()
}

function lastValidity(wrapper: Editor): boolean | undefined {
  const events = wrapper.emitted('validity')
  const last = events?.[events.length - 1]
  return typeof last?.[0] === 'boolean' ? last[0] : undefined
}

describe('实时校验', () => {
  it('挂上就校验一次现有公式，通过后亮「可用」并画出读法', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('可用')
    expect(wrapper.find('.nt-col').exists()).toBe(true)
    expect(lastValidity(wrapper)).toBe(true)
  })

  it('⚠ 防抖 400ms：没到点一次都不发', async () => {
    const wrapper = await open()
    vi.mocked(dataset.validateDatasetFormula).mockClear()
    await type(wrapper, '{进水量} +')
    await vi.advanceTimersByTimeAsync(VALIDATE_DEBOUNCE_MS - 50)
    expect(dataset.validateDatasetFormula).not.toHaveBeenCalled()
    await settle()
    expect(dataset.validateDatasetFormula).toHaveBeenCalledTimes(1)
  })

  it('连着敲只发最后那一次', async () => {
    const wrapper = await open()
    vi.mocked(dataset.validateDatasetFormula).mockClear()
    await type(wrapper, '{进')
    await type(wrapper, '{进水')
    await type(wrapper, '{进水量}')
    await settle()
    expect(dataset.validateDatasetFormula).toHaveBeenCalledTimes(1)
  })

  it('⚠ is_ok=false 是正常的编辑器状态，不是请求失败', async () => {
    vi.mocked(dataset.validateDatasetFormula).mockResolvedValue(
      validation({
        is_ok: false,
        error: '公式写不通：少了一个右括号',
        deps: null,
      }),
    )
    const wrapper = await open('{进水量} +')
    expect(wrapper.text()).toContain('少了一个右括号')
    expect(wrapper.text()).not.toContain('校验服务连不上')
    expect(lastValidity(wrapper)).toBe(false)
  })

  it('⚠ 校验这条链路打不通时不拦保存：「不知道对不对」不是「不对」', async () => {
    vi.mocked(dataset.validateDatasetFormula).mockRejectedValue(
      new Error('boom'),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('校验服务连不上')
    expect(lastValidity(wrapper)).toBe(true)
  })

  it('⚠ 慢的那次回来晚了不许覆盖新结论', async () => {
    const wrapper = await open()
    let releaseSlow: (value: DatasetFormulaValidation) => void = () => {}
    vi.mocked(dataset.validateDatasetFormula)
      .mockImplementationOnce(
        () =>
          new Promise<DatasetFormulaValidation>((resolve) => {
            releaseSlow = resolve
          }),
      )
      .mockResolvedValue(validation({ notation_text: '出水量' }))

    await type(wrapper, '{进水量} + 1')
    await vi.advanceTimersByTimeAsync(VALIDATE_DEBOUNCE_MS)
    await type(wrapper, '{出水量} + 2')
    await settle()
    // 慢的那次这时才回来，且带着一句会误导人的旧结论
    releaseSlow(validation({ is_ok: false, error: '旧的错误', deps: null }))
    await flushPromises()

    expect(wrapper.text()).not.toContain('旧的错误')
    expect(wrapper.text()).toContain('可用')
  })
})

describe('时序规矩三：文本一变立刻熄灯', () => {
  it('改一个字符就撤掉上一次的结论与读法', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('可用')
    await type(wrapper, '{进水量} + ')
    expect(wrapper.text()).not.toContain('可用')
    expect(wrapper.find('.nt-col').exists()).toBe(false)
    expect(lastValidity(wrapper)).toBe(false)
  })

  it('清空即回到未校验态，也不再发请求', async () => {
    const wrapper = await open()
    vi.mocked(dataset.validateDatasetFormula).mockClear()
    await type(wrapper, '   ')
    await settle()
    expect(dataset.validateDatasetFormula).not.toHaveBeenCalled()
    expect(lastValidity(wrapper)).toBe(false)
  })
})

describe('时序规矩一：分段面只在切进去那一刻播种', () => {
  it('拆得开就按各档播种', async () => {
    const wrapper = await open('IF({进水量} > 0, 1, 0)')
    await click(wrapper, '分段')
    const boxes = wrapper.findAll('textarea')
    expect(boxes.map((one) => one.element.value)).toEqual([
      '{进水量} > 0',
      '1',
      '0',
    ])
  })

  it('⚠ 拆不开就把整条公式放进「否则」，不许丢掉用户写好的算式', async () => {
    const wrapper = await open('{进水量} - {出水量}')
    await click(wrapper, '分段')
    const boxes = wrapper.findAll('textarea')
    expect(boxes.map((one) => one.element.value)).toEqual([
      '',
      '',
      '{进水量} - {出水量}',
    ])
  })

  it('⚠ 播种之后校验回包不许再动各档：正在打字的那一格会被光标复位', async () => {
    const wrapper = await open('IF({进水量} > 0, 1, 0)')
    await click(wrapper, '分段')
    // 在第一档的取值里接着打字
    await wrapper.findAll('textarea')[1]?.setValue('12')
    await settle()
    expect(wrapper.findAll('textarea')[1]?.element.value).toBe('12')
  })

  it('改一档就拼回同一行文本，多档拼成 IFS', async () => {
    const wrapper = await open('IF({进水量} > 0, 1, 0)')
    await click(wrapper, '分段')
    await click(wrapper, '加一个分支')
    await wrapper.findAll('textarea')[2]?.setValue('{出水量} > 0')
    await flushPromises()
    const emitted = wrapper.emitted('update:formula')
    expect(emitted?.[emitted.length - 1]?.[0]).toBe(
      'IFS({进水量} > 0, 1, {出水量} > 0, , 0)',
    )
  })
})

describe('时序规矩二：切回文本面重置选区', () => {
  it('⚠ 切回来再插入不许吃掉开头几个字符', async () => {
    const wrapper = await open('{进水量} - {出水量}')
    // 先在文本面留一个指向老字符串中段的选区
    const box = textarea(wrapper)
    box.element.setSelectionRange(0, 6)
    await box.trigger('select')

    await click(wrapper, '分段')
    await click(wrapper, '文本')
    // 从工具箱插一列：选区若没重置，这一插会把开头六个字符替换掉
    await clickChip(wrapper, '进水量')

    const emitted = wrapper.emitted('update:formula')
    const last = emitted?.[emitted.length - 1]?.[0]
    expect(last).toBe('{进水量} - {出水量}{进水量}')
  })
})

describe('两种面共用同一条公式', () => {
  it('分段面下工具箱插进最近聚焦的那一格，而不是那个已经不在的文本框', async () => {
    const wrapper = await open('IF({进水量} > 0, 1, 0)')
    await click(wrapper, '分段')
    const box = wrapper.findAll('textarea')[1]
    box?.element.setSelectionRange(0, 1)
    await box?.trigger('select')
    await clickChip(wrapper, '出水量')
    const emitted = wrapper.emitted('update:formula')
    expect(emitted?.[emitted.length - 1]?.[0]).toBe(
      'IF({进水量} > 0, {出水量}, 0)',
    )
  })

  it('删到一档不剩就不再是分支公式，把兜底那一支留成整条公式', async () => {
    const wrapper = await open('IF({进水量} > 0, 1, {出水量})')
    await click(wrapper, '分段')
    const remove = wrapper
      .findAll('button')
      .find((one) => one.attributes('aria-label') === '删除第 1 档')
    await remove?.trigger('click')
    await flushPromises()
    const emitted = wrapper.emitted('update:formula')
    expect(emitted?.[emitted.length - 1]?.[0]).toBe('{出水量}')
    // 退回文本面：分段面上已经没有可编辑的档了
    expect(wrapper.find('textarea').attributes('aria-label')).toBe('公式')
  })

  it('清空回到未校验态，且退回文本面', async () => {
    const wrapper = await open('IF({进水量} > 0, 1, 0)')
    await click(wrapper, '分段')
    const clear = wrapper
      .findAll('button')
      .find((one) => one.attributes('aria-label') === '清空公式')
    await clear?.trigger('click')
    await flushPromises()
    const emitted = wrapper.emitted('update:formula')
    expect(emitted?.[emitted.length - 1]?.[0]).toBe('')
    expect(wrapper.find('textarea').attributes('aria-label')).toBe('公式')
  })
})

describe('降级', () => {
  it('⚠ 函数目录取不到只是没有快速插入，公式照样能写、照样校验', async () => {
    vi.mocked(dataset.getDatasetFormulaCatalog).mockRejectedValue(
      new Error('boom'),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('取不到函数目录')
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('可用')
    expect(lastValidity(wrapper)).toBe(true)
  })
})
