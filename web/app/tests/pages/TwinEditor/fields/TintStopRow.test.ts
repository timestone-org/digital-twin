/**
 * @fileoverview 契约：一档取色的行按命中方式换输入框，并把「上界不含」写在两个
 * 输入框之间。
 *
 * ⚠ 边界值归哪一档看不出来时，用户只能靠试；写在这里是唯一能当场确认的地方。
 */
import type { TwinTintStop } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TintStopRow from '@/pages/TwinEditor/components/fields/TintStopRow.vue'

function stop(over: Partial<TwinTintStop> = {}): TwinTintStop {
  return {
    id: 's1',
    match: 'range',
    from: null,
    to: null,
    equals: '',
    color: '',
    label: '',
    ...over,
  }
}

function mountRow(over: Partial<TwinTintStop> = {}, index = 0, total = 3) {
  return mount(TintStopRow, {
    props: { modelValue: stop(over), index, total, swatches: [] },
  })
}

type Wrapper = ReturnType<typeof mountRow>

function lastWrite(wrapper: Wrapper): TwinTintStop {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回档位')
  return events[events.length - 1]?.[0] as TwinTintStop
}

describe('命中方式', () => {
  it('区间档摆两个数字框，并写明上界不含', () => {
    const wrapper = mountRow({ match: 'range' })

    expect(wrapper.find('input[aria-label="下界（含）"]').exists()).toBe(true)
    expect(wrapper.find('input[aria-label="上界（不含）"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('≤ 值 <')
  })

  it('等值档只摆一个文本框，数值与状态码共用它', () => {
    const wrapper = mountRow({ match: 'equals' })

    expect(wrapper.find('input[aria-label="等于"]').exists()).toBe(true)
    expect(wrapper.find('input[aria-label="下界（含）"]').exists()).toBe(false)
  })

  it('切命中方式只改这一项，已填的两边取值都留着', async () => {
    const wrapper = mountRow({ match: 'range', from: 10, equals: 'run' })

    const toEquals = wrapper
      .findAll('button')
      .find((item) => item.text() === '等于某值')
    await toEquals?.trigger('click')

    expect(lastWrite(wrapper)).toMatchObject({
      match: 'equals',
      from: 10,
      equals: 'run',
    })
  })
})

describe('取值', () => {
  // ⚠ 「没设下界」与「下界是 0」不是一回事：写成 0 会让负值全部落在这一档之外
  it('清空下界写回 null，不是 0', async () => {
    const wrapper = mountRow({ match: 'range', from: 10 })

    await wrapper.find('input[aria-label="下界（含）"]').setValue('')

    expect(lastWrite(wrapper).from).toBeNull()
  })

  it('填上界写回数字', async () => {
    const wrapper = mountRow({ match: 'range' })

    await wrapper.find('input[aria-label="上界（不含）"]').setValue('80')

    expect(lastWrite(wrapper).to).toBe(80)
  })

  it('档位说明整份写回', async () => {
    const wrapper = mountRow()

    await wrapper.find('input[aria-label="档位说明"]').setValue('偏高')

    expect(lastWrite(wrapper).label).toBe('偏高')
  })
})

describe('挪动与删除', () => {
  it('上下移各上抛一个方向', async () => {
    const wrapper = mountRow({}, 1)

    await wrapper.find('button[aria-label="上移档位"]').trigger('click')
    await wrapper.find('button[aria-label="下移档位"]').trigger('click')

    expect(wrapper.emitted('move')).toEqual([[-1], [1]])
  })

  it('删除只上抛一个信号，由上层整份重建', async () => {
    const wrapper = mountRow()

    await wrapper.find('button[aria-label="删除档位"]').trigger('click')

    expect(wrapper.emitted('remove')).toHaveLength(1)
  })

  it('行号从 1 起，与档位表上的顺序一致', () => {
    expect(mountRow({}, 2).text()).toContain('第 3 档')
  })
})
