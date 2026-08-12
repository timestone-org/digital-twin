/**
 * @fileoverview 锁住 DtDateTimeInput 的取值口径：对外 UTC RFC3339、对用户本地时，
 * 键入与日历两条路走同一套换算，档位一路透到底。
 * ⚠ 用例把 TZ 钉死——不钉的话，跑用例的机器在哪个时区会决定这份断言的对错，
 * 而这正是这个组件要挡的那类 8 小时偏差。
 */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DtDateTimeInput from '../../src/components/DtDateTimeInput/DtDateTimeInput.vue'

const SHANGHAI = 'Asia/Shanghai' // UTC+8，无夏令时

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllEnvs()
  document.body.innerHTML = ''
})

// ⚠ 必须挂到 document.body 上：日历浮层是 Teleport 出去的，不挂的话
// document.querySelector 一个都找不到，而「断言它不存在」会假绿。
function mountInShanghai(props: Record<string, unknown> = {}) {
  vi.stubEnv('TZ', SHANGHAI)
  return mount(DtDateTimeInput, { props, attachTo: document.body })
}

describe('DtDateTimeInput 取值换算', () => {
  it('UTC 的 modelValue 渲染成本地时', () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    expect(wrapper.find('input').element.value).toBe('2026-08-12T10:55')
  })

  it('用户输入本地时，emit 出去的是 UTC', async () => {
    const wrapper = mountInShanghai()
    await wrapper.find('input').setValue('2026-08-12T10:55')
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['2026-08-12T02:55:00.000Z'],
    ])
  })

  it('没有取值时输入框是空的', () => {
    const wrapper = mountInShanghai()
    expect(wrapper.find('input').element.value).toBe('')
  })

  it('清空输入框 emit 空串，而不是一个坏时刻', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    await wrapper.find('input').setValue('')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  it('输入不成形状时 emit 空串，不把半成品抛给上层', async () => {
    const wrapper = mountInShanghai()
    await wrapper.find('input').setValue('2026-08-12T10')
    expect(wrapper.emitted('update:modelValue')).toEqual([['']])
  })

  it('解析不出的 modelValue 渲染成空而不是 Invalid Date', () => {
    const wrapper = mountInShanghai({ modelValue: '不是时刻' })
    expect(wrapper.find('input').element.value).toBe('')
  })

  it('父组件回写新的 UTC 值时显示跟着走', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    await wrapper.setProps({ modelValue: '2026-08-12T03:55:00.000Z' })
    expect(wrapper.find('input').element.value).toBe('2026-08-12T11:55')
  })
})

describe('DtDateTimeInput 上下界', () => {
  it('min 与 max 同样按本地时落到原生属性上', () => {
    const wrapper = mountInShanghai({
      min: '2026-08-12T00:00:00.000Z',
      max: '2026-08-12T12:00:00.000Z',
    })
    const input = wrapper.find('input')
    expect(input.attributes('min')).toBe('2026-08-12T08:00')
    expect(input.attributes('max')).toBe('2026-08-12T20:00')
  })

  it('没给上下界时属性不出现', () => {
    const input = mountInShanghai().find('input')
    expect(input.attributes('min')).toBeUndefined()
    expect(input.attributes('max')).toBeUndefined()
  })

  it('步长固定到分钟：秒不该出现在这个控件里', () => {
    expect(mountInShanghai().find('input').attributes('step')).toBe('60')
  })
})

describe('DtDateTimeInput 表单契约', () => {
  it('label 与输入框通过 id 关联', () => {
    const wrapper = mountInShanghai({ label: '起始时间' })
    const id = wrapper.find('input').attributes('id')
    expect(wrapper.find('label').attributes('for')).toBe(id)
  })

  it('hint 经 aria-describedby 关联', () => {
    const wrapper = mountInShanghai({ hint: '按分钟取值' })
    const described = wrapper.find('input').attributes('aria-describedby')
    expect(wrapper.find(`#${described}`).text()).toBe('按分钟取值')
  })

  it('error 时标 aria-invalid，并用 role=alert 播报', () => {
    const wrapper = mountInShanghai({ error: '起始时间不能晚于结束时间' })
    expect(wrapper.find('input').attributes('aria-invalid')).toBe('true')
    expect(wrapper.find('[role="alert"]').text()).toBe(
      '起始时间不能晚于结束时间',
    )
    expect(wrapper.find('.dt-datetime').classes()).toContain(
      'dt-datetime--invalid',
    )
  })

  it('required 透到原生属性并标星', () => {
    const wrapper = mountInShanghai({ label: '起始时间', required: true })
    expect(wrapper.find('input').attributes('required')).toBeDefined()
    expect(wrapper.find('.dt-field__required').exists()).toBe(true)
  })

  it('disabled 时禁用且加修饰类', () => {
    const wrapper = mountInShanghai({ disabled: true })
    expect(wrapper.find('input').attributes('disabled')).toBe('')
    expect(wrapper.find('.dt-datetime').classes()).toContain(
      'dt-datetime--disabled',
    )
  })

  it.each(['sm', 'md', 'lg'] as const)('size=%s 落到档位类上', (size) => {
    const wrapper = mountInShanghai({ size })
    expect(wrapper.find('.dt-datetime').classes()).toContain(
      `dt-datetime--${size}`,
    )
  })

  it('aria-label / name 这类原生属性逐个透传', () => {
    const wrapper = mountInShanghai({
      'aria-label': '起始时间',
      name: 'started_at',
    })
    const input = wrapper.find('input')
    expect(input.attributes('aria-label')).toBe('起始时间')
    expect(input.attributes('name')).toBe('started_at')
  })
})

/* 日历浮层 */

function openCalendar(): void {
  const trigger = [...document.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === '选择日期时间',
  )
  if (trigger === undefined) throw new Error('找不到打开日历的按钮')
  trigger.click()
}

function dayButton(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label,
  )
  if (found === undefined) throw new Error(`日历里没有「${label}」`)
  return found
}

describe('DtDateTimeInput 日历浮层', () => {
  it('点日历键才展开面板，展开前面板不在 DOM 里', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    expect(document.querySelector('[aria-label="选择日期"]')).toBeNull()
    openCalendar()
    await flushPromises()
    expect(document.querySelector('[aria-label="选择日期"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('面板停在取值所在的那个月', async () => {
    mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    openCalendar()
    await flushPromises()
    expect(document.body.textContent).toContain('2026 年 8 月')
  })

  it('点某一天 emit 的是 UTC，且保留原来的时分', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    openCalendar()
    await flushPromises()
    dayButton('2026 年 8 月 20 日').click()
    await flushPromises()
    // 本地 8-20 10:55（东八区）回到 UTC 就是 8-20 02:55
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['2026-08-20T02:55:00.000Z'],
    ])
  })

  it('还没有取值时点某一天从零点起算', async () => {
    const wrapper = mountInShanghai()
    openCalendar()
    await flushPromises()
    const title = document.querySelector('.dt-calendar__title')?.textContent
    const [year, month] = (title ?? '').split(' 年 ')
    dayButton(`${year} 年 ${month?.replace(' 月', '')} 月 15 日`).click()
    await flushPromises()
    const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0]
    expect(emitted).toMatch(/T16:00:00\.000Z$/)
  })

  it('选完就收起面板，不用再点一次别处', async () => {
    mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    openCalendar()
    await flushPromises()
    dayButton('2026 年 8 月 20 日').click()
    await flushPromises()
    expect(document.querySelector('[aria-label="选择日期"]')).toBeNull()
  })

  it('整天都在下界之前的日子点不动', async () => {
    mountInShanghai({
      modelValue: '2026-08-12T02:55:00.000Z',
      min: '2026-08-12T00:00:00.000Z',
    })
    openCalendar()
    await flushPromises()
    // 东八区下界落在 8-12 08:00，8 月 10 日整天都在它之前
    expect(dayButton('2026 年 8 月 10 日').disabled).toBe(true)
    expect(dayButton('2026 年 8 月 20 日').disabled).toBe(false)
  })

  it('选中的日子落在界外时夹回界内，而不是抛一个越界值出去', async () => {
    const wrapper = mountInShanghai({
      modelValue: '2026-08-20T02:55:00.000Z',
      max: '2026-08-20T00:00:00.000Z',
    })
    openCalendar()
    await flushPromises()
    // 上界本地时是 8-20 08:00，而当前时分是 10:55，落在界外
    dayButton('2026 年 8 月 20 日').click()
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['2026-08-20T00:00:00.000Z'],
    ])
  })

  it('翻月改的是面板，不动取值', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    openCalendar()
    await flushPromises()
    const next = [...document.querySelectorAll('button')].find(
      (node) => node.getAttribute('aria-label') === '下个月',
    )
    next?.click()
    await flushPromises()
    expect(document.body.textContent).toContain('2026 年 9 月')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('禁用时日历键点不开', async () => {
    mountInShanghai({ disabled: true })
    openCalendar()
    await flushPromises()
    expect(document.querySelector('[aria-label="选择日期"]')).toBeNull()
  })
})

/** 在面板里那两个下拉之一上选一项。 */
async function pickTime(field: string, label: string): Promise<void> {
  const trigger = [...document.querySelectorAll('[role="combobox"]')].find(
    (node) => node.getAttribute('aria-label') === field,
  )
  trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

describe('DtDateTimeInput 面板里的时分', () => {
  it('改小时保留原来的日期与分钟，emit 出去仍是 UTC', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    openCalendar()
    await flushPromises()
    await pickTime('小时', '13')
    // 本地 8-12 13:55（东八区）回到 UTC 是 8-12 05:55
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['2026-08-12T05:55:00.000Z'],
    ])
  })

  it('改分钟同理', async () => {
    const wrapper = mountInShanghai({ modelValue: '2026-08-12T02:55:00.000Z' })
    openCalendar()
    await flushPromises()
    await pickTime('分钟', '05')
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['2026-08-12T02:05:00.000Z'],
    ])
  })

  it('还没选过日子时改时分落在当月 1 号，而不是抛一个没有日期的值', async () => {
    const wrapper = mountInShanghai()
    openCalendar()
    await flushPromises()
    await pickTime('小时', '08')
    const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0]
    expect(emitted).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/)
  })

  it('时分把取值顶到界外时同样夹回来', async () => {
    const wrapper = mountInShanghai({
      modelValue: '2026-08-12T02:55:00.000Z',
      max: '2026-08-12T04:00:00.000Z',
    })
    openCalendar()
    await flushPromises()
    // 上界本地时是 12:00，选 23 点会越界
    await pickTime('小时', '23')
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['2026-08-12T04:00:00.000Z'],
    ])
  })
})

describe('DtDateTimeInput 档位透传', () => {
  it.each([
    ['sm', 14],
    ['md', 16],
    ['lg', 18],
  ] as const)('size=%s 时日历键里的图标是 %ipx', (size, px) => {
    mountInShanghai({ size })
    const icon = document.querySelector('.dt-datetime__picker svg')
    expect(icon?.getAttribute('width')).toBe(String(px))
  })

  it('档位一路传到面板里的时分选择器上——只落到类名上等于没传', async () => {
    mountInShanghai({ size: 'sm' })
    openCalendar()
    await flushPromises()
    const hour = [...document.querySelectorAll('[role="combobox"]')].find(
      (node) => node.getAttribute('aria-label') === '小时',
    )
    expect(
      hour?.closest('.dt-select')?.classList.contains('dt-select--sm'),
    ).toBe(true)
  })
})
