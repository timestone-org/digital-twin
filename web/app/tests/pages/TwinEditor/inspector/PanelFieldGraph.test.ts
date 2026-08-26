/**
 * @fileoverview 契约：信息牌字段的画法组把三件不写就看不出来的事摆在明面上。
 *
 * 一是**换画法不改行号**——八种画法都只吃一个值，绑定不会跟着错位，不写明用户不敢动；
 * 二是趋势线攒的是本次会话内收到的读数、不查历史库，不写明「刚打开时图是空的」会被
 * 当成绑定没生效；三是量程颠倒时图形退回纯文本，必须当场说，否则就是「配了没反应」。
 *
 * 另锁住：只有吃量程的画法才给量程输入——给不吃量程的画法摆一个改了没反应的输入框，
 * 比不给更糟。
 */
import type { TwinPanelField } from '@dt/twin-config'
import { DtNumberInput, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PanelFieldGraph from '@/pages/TwinEditor/components/fields/PanelFieldGraph.vue'

function fieldOf(over: Partial<TwinPanelField> = {}): TwinPanelField {
  return {
    key: 'f1',
    label: '温度',
    unit: '℃',
    prefix: '',
    decimals: null,
    staticText: '',
    kind: 'text',
    min: 0,
    max: 100,
    levels: [],
    ...over,
  }
}

function mountGraph(field: TwinPanelField) {
  return mount(PanelFieldGraph, { props: { field } })
}

type Wrapper = ReturnType<typeof mountGraph>

/** 这个组件只往外发 patch，不改 props；用例一律读这一份。 */
function patchOf(wrapper: Wrapper): Partial<TwinPanelField> {
  const events = wrapper.emitted('update')
  if (!events?.[0]) throw new Error('没有写回字段')
  return events[0][0] as Partial<TwinPanelField>
}

function selectByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('ariaLabel') === label)
  if (!found) throw new Error(`未找到下拉：${label}`)
  return found
}

/**
 * 往一个数字框里键入并落定。
 * ⚠ 走原生 `<input>` 而不是组件的 `setValue`：DtNumberInput 关掉了
 * `inheritAttrs`，`aria-label` 落在里面那个 `<input>` 上，组件包装器上既没有
 * 这个属性也没有同名 prop——按 props 找会一个也找不到。
 * ⚠ 必须 `change` 才落定：`input` 只改显示，键入过程中不回写（那样「先删一位
 * 再补」会被中途的夹取吃掉）。
 */
async function typeNumber(
  wrapper: Wrapper,
  label: string,
  text: string,
): Promise<void> {
  const found = wrapper.findAll('input').find(
    (item) =>
      item.attributes('aria-label') === label ||
      // 有可见标签的那几个：DtField 把标签的 for 指到输入框的 id 上
      wrapper.find(`label[for="${item.attributes('id') ?? ''}"]`).text() ===
        label,
  )
  if (!found) throw new Error(`未找到数字框：${label}`)
  await found.setValue(text)
  await found.trigger('change')
}

describe('画法', () => {
  it('八种画法都列在下拉里', () => {
    const wrapper = mountGraph(fieldOf())

    expect(selectByLabel(wrapper, '画法').props('options')).toHaveLength(8)
  })

  it('选一档写回 kind', async () => {
    const wrapper = mountGraph(fieldOf())

    await selectByLabel(wrapper, '画法').setValue('gauge')

    expect(patchOf(wrapper)).toEqual({ kind: 'gauge' })
  })

  // ⚠ 下拉给回来的是裸字符串：对不上还照写的话，配置里会多出一个渲染层不认的画法
  it('对不上任何一档的值当没改', async () => {
    const wrapper = mountGraph(fieldOf())

    await selectByLabel(wrapper, '画法').setValue('radar')

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  // ⚠ 换画法不改行数，用户才敢动它
  it('写明换画法不会让绑定错位', () => {
    expect(mountGraph(fieldOf()).text()).toContain('换画法不改行号')
  })
})

describe('量程', () => {
  it('不吃量程的画法不给量程输入', () => {
    const wrapper = mountGraph(fieldOf({ kind: 'text' }))

    expect(
      wrapper
        .findAllComponents(DtNumberInput)
        .some((item) => item.props('label') === '量程上限'),
    ).toBe(false)
  })

  it('吃量程的画法给上下限两个输入，改了各写各的', async () => {
    const wrapper = mountGraph(fieldOf({ kind: 'bar' }))

    await typeNumber(wrapper, '量程上限', '250')

    expect(patchOf(wrapper)).toEqual({ max: 250 })
  })

  it('清空量程输入时按 0 写回，不写 undefined', async () => {
    const wrapper = mountGraph(fieldOf({ kind: 'bar' }))

    await typeNumber(wrapper, '量程下限', '')

    expect(patchOf(wrapper)).toEqual({ min: 0 })
  })

  // ⚠ 渲染层遇到颠倒的量程退回纯文本：不当场说，用户只会以为是画法没生效
  it('量程颠倒时当场说会退回纯文本', () => {
    const wrapper = mountGraph(fieldOf({ kind: 'gauge', min: 80, max: 20 }))

    expect(wrapper.text()).toContain('退回纯文本')
  })

  it('量程正常时不报这一句', () => {
    const wrapper = mountGraph(fieldOf({ kind: 'gauge', min: 0, max: 100 }))

    expect(wrapper.text()).not.toContain('退回纯文本')
  })

  // ⚠ 同样颠倒的量程，配在不吃量程的画法上无所谓——报出来只会变成噪音
  it('不吃量程的画法配着颠倒的量程也不报', () => {
    const wrapper = mountGraph(fieldOf({ kind: 'text', min: 80, max: 20 }))

    expect(wrapper.text()).not.toContain('退回纯文本')
  })
})

describe('走势序列', () => {
  // ⚠ 攒的是本次会话内收到的读数：不写明的话，刚打开大屏时图是空的会被当成绑定没生效
  it('趋势线与柱群写明不查历史库', () => {
    for (const kind of ['sparkline', 'bars'] as const) {
      expect(mountGraph(fieldOf({ kind })).text()).toContain('不查历史库')
    }
  })

  it('别的画法不说这一句', () => {
    expect(mountGraph(fieldOf({ kind: 'bar' })).text()).not.toContain(
      '不查历史库',
    )
  })
})

describe('阈值档', () => {
  function addButton(wrapper: Wrapper) {
    const found = wrapper
      .findAll('button')
      .find((item) => item.text().includes('添加阈值档'))
    if (!found) throw new Error('未找到添加阈值档的按钮')
    return found
  }

  it('加一档给一个档内不重名的 id，缺省是预警色', async () => {
    const wrapper = mountGraph(fieldOf({ kind: 'bar', max: 120 }))

    await addButton(wrapper).trigger('click')

    expect(patchOf(wrapper)).toEqual({
      levels: [{ id: 'level-1', at: 120, tone: 'warning' }],
    })
  })

  it('已有档时新档的 id 不与它们撞', async () => {
    const wrapper = mountGraph(
      fieldOf({ levels: [{ id: 'level-2', at: 60, tone: 'warning' }] }),
    )

    await addButton(wrapper).trigger('click')

    expect(patchOf(wrapper).levels?.[1]?.id).toBe('level-3')
  })

  it('改阈值只动那一档', async () => {
    const wrapper = mountGraph(
      fieldOf({
        levels: [
          { id: 'a', at: 60, tone: 'warning' },
          { id: 'b', at: 90, tone: 'danger' },
        ],
      }),
    )

    await typeNumber(wrapper, '阈值', '70')

    expect(patchOf(wrapper).levels).toEqual([
      { id: 'a', at: 70, tone: 'warning' },
      { id: 'b', at: 90, tone: 'danger' },
    ])
  })

  it('改档位颜色只动那一档', async () => {
    const wrapper = mountGraph(
      fieldOf({ levels: [{ id: 'a', at: 60, tone: 'warning' }] }),
    )

    await selectByLabel(wrapper, '档位颜色').setValue('danger')

    expect(patchOf(wrapper).levels).toEqual([
      { id: 'a', at: 60, tone: 'danger' },
    ])
  })

  it('对不上任何一档色的值当没改', async () => {
    const wrapper = mountGraph(
      fieldOf({ levels: [{ id: 'a', at: 60, tone: 'warning' }] }),
    )

    await selectByLabel(wrapper, '档位颜色').setValue('紫')

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('删一档按 id 删，不按下标', async () => {
    const wrapper = mountGraph(
      fieldOf({
        levels: [
          { id: 'a', at: 60, tone: 'warning' },
          { id: 'b', at: 90, tone: 'danger' },
        ],
      }),
    )
    const remove = wrapper
      .findAll('button')
      .filter((item) => item.attributes('aria-label') === '删除阈值档')

    await remove[0]?.trigger('click')

    expect(patchOf(wrapper).levels).toEqual([
      { id: 'b', at: 90, tone: 'danger' },
    ])
  })

  it('到了上限就不再给添加按钮', () => {
    const levels = Array.from({ length: 6 }, (_, index) => ({
      id: `l${index}`,
      at: index * 10,
      tone: 'warning' as const,
    }))
    const wrapper = mountGraph(fieldOf({ levels }))

    expect(
      wrapper
        .findAll('button')
        .some((item) => item.text().includes('添加阈值档')),
    ).toBe(false)
  })

  // ⚠ 取的是满足条件里阈值最大的那一档，不是写在前面的那一档
  it('多于一档时写明取的是阈值最大的那一档', () => {
    const wrapper = mountGraph(
      fieldOf({
        levels: [
          { id: 'a', at: 60, tone: 'warning' },
          { id: 'b', at: 90, tone: 'danger' },
        ],
      }),
    )

    expect(wrapper.text()).toContain('取阈值最大的那一档')
  })

  it('只有一档时不啰嗦这一句', () => {
    const wrapper = mountGraph(
      fieldOf({ levels: [{ id: 'a', at: 60, tone: 'warning' }] }),
    )

    expect(wrapper.text()).not.toContain('取阈值最大的那一档')
  })
})
