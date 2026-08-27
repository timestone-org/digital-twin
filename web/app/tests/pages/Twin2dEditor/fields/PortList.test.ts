/**
 * @fileoverview 契约：引脚表的增删改——id 是寻址键所以走草稿、失焦才落，空名与重名
 * 一律落不下去；落点两档换来换去取的是归一化缺省；引脚符号开了就看得见。
 *
 * ⚠ id 逐键写回会让这一行每敲一个字就整行重建（id 同时是 v-for 的 key），焦点当场
 * 丢掉；而落下去的每一次改名都会让挂在旧 id 上的连线落空，所以旁边必须写明有几条。
 * ⚠ 重名不写回：归一化按 id 去重且留最先那一条，另一条会在存盘那一刻凭空消失。
 * ⚠ 落点缺省在这里抄一份就会与归一化漂开，换档之后存一次再读回来会悄悄变样。
 */
import { TWIN_2D_PORT_DIRS, TWIN_2D_PORT_SIDES } from '@dt/twin2d'
import type { Twin2dPort } from '@dt/twin2d'
import type { DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PortList from '@/pages/Twin2dEditor/components/fields/PortList.vue'

function port(over: Partial<Twin2dPort> = {}): Twin2dPort {
  return {
    id: 'p1',
    name: '1',
    at: { kind: 'perim', t: 0 },
    dir: 'both',
    side: 'auto',
    showName: false,
    marker: null,
    ...over,
  }
}

function mountList(
  rows: readonly Twin2dPort[],
  usage?: Readonly<Record<string, number>>,
) {
  return mount(PortList, {
    props:
      usage === undefined ? { modelValue: rows } : { modelValue: rows, usage },
  })
}

type Wrapper = ReturnType<typeof mountList>

function lastWrite(wrapper: Wrapper): readonly Twin2dPort[] {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回引脚表')
  return events[events.length - 1]?.[0] as readonly Twin2dPort[]
}

function selectBy(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('label') === label)
  if (found === undefined) throw new Error(`没有标着「${label}」的下拉`)
  return found
}

describe('增删', () => {
  it('一个引脚都没有时给空态与新增键', () => {
    const wrapper = mountList([])

    expect(wrapper.find('[data-test="port-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="port-add"]').exists()).toBe(true)
  })

  it('新增一个落在末尾，id 不与已有的重名', async () => {
    const wrapper = mountList([port({ id: 'port-aaaaaa' })])

    await wrapper.find('[data-test="port-add"]').trigger('click')
    const rows = lastWrite(wrapper)

    expect(rows).toHaveLength(2)
    expect(rows[1]?.id).not.toBe('port-aaaaaa')
    expect(rows[1]?.id).not.toBe('')
  })

  it('新引脚落在周长起点、朝向待解析', async () => {
    const wrapper = mountList([])

    await wrapper.find('[data-test="port-add"]').trigger('click')

    expect(lastWrite(wrapper)[0]).toMatchObject({
      at: { kind: 'perim', t: 0 },
      side: 'auto',
      marker: null,
    })
  })

  it('删除只删被点名的那一个', async () => {
    const wrapper = mountList([port(), port({ id: 'p2' })])

    await wrapper.find('[data-test="port-remove-p1"]').trigger('click')

    expect(lastWrite(wrapper).map((row) => row.id)).toEqual(['p2'])
  })
})

describe('改 id', () => {
  it('逐键只写草稿，一个字都不写回文档', async () => {
    const wrapper = mountList([port()])

    await wrapper.find('[data-test="port-id-p1"]').setValue('vcc')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('失焦才落，落下去的是去过空白的那一版', async () => {
    const wrapper = mountList([port()])
    const box = wrapper.find('[data-test="port-id-p1"]')

    await box.setValue('  vcc  ')
    await box.trigger('focusout')

    expect(lastWrite(wrapper)[0]?.id).toBe('vcc')
  })

  it('改成另一个引脚已经占着的 id 时落不下去且当场标红', async () => {
    const wrapper = mountList([port(), port({ id: 'p2' })])
    const box = wrapper.find('[data-test="port-id-p1"]')

    await box.setValue('p2')
    expect(wrapper.text()).toContain('已经被另一个引脚占着')

    await box.trigger('focusout')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('改成空的时候落不下去且当场标红', async () => {
    const wrapper = mountList([port()])
    const box = wrapper.find('[data-test="port-id-p1"]')

    await box.setValue('   ')
    expect(wrapper.text()).toContain('挂不上连线')

    await box.trigger('focusout')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('旁边写着现在有几条连线挂着', () => {
    expect(mountList([port()], { p1: 3 }).text()).toContain('有 3 条连线')
  })

  it('一条都没挂时明说改 id 是安全的', () => {
    expect(mountList([port()], { p1: 0 }).text()).toContain('是安全的')
  })

  it('不给引用数时只给一句通用提示', () => {
    expect(mountList([port()]).text()).toContain('改 id 等于换一个引脚')
  })
})

describe('方向与朝向', () => {
  it('方向四档一档不少', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([port()]),
      '方向',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_PORT_DIRS,
    ])
  })

  it('出线朝向五档一档不少，含自动那一档', () => {
    const options: readonly DtSelectOption[] = selectBy(
      mountList([port()]),
      '出线朝向',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_PORT_SIDES,
    ])
  })

  it('换方向与换朝向各写各的，认不出的取值不写回', () => {
    const wrapper = mountList([port()])

    selectBy(wrapper, '方向').vm.$emit('update:modelValue', 'in')
    expect(lastWrite(wrapper)[0]).toMatchObject({ dir: 'in' })

    selectBy(wrapper, '出线朝向').vm.$emit('update:modelValue', 'nope')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('引脚名逐键写回且不去空白', async () => {
    const wrapper = mountList([port()])

    await wrapper.find('[data-test="port-name-p1"]').setValue('GND ')

    expect(lastWrite(wrapper)[0]?.name).toBe('GND ')
  })

  it('显示引脚名是一个开关', async () => {
    const wrapper = mountList([port()])

    await wrapper.find('[data-test="port-show-name-p1"] input').setValue(true)

    expect(lastWrite(wrapper)[0]?.showName).toBe(true)
  })
})

describe('落点两档', () => {
  it('周长那一档只摆一个位置格', () => {
    const wrapper = mountList([port()])

    expect(wrapper.find('[data-test="port-t-p1"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="port-x-p1"]').exists()).toBe(false)
  })

  // ⚠ 缺省抄一份就会与 normalizePortAt 漂开，换档之后存一次再读回来会悄悄变样
  it('换到盒内坐标那一档落在正中', () => {
    const wrapper = mountList([port()])

    selectBy(wrapper, '落点').vm.$emit('update:modelValue', 'xy')

    expect(lastWrite(wrapper)[0]?.at).toEqual({ kind: 'xy', x: 0.5, y: 0.5 })
  })

  it('换回周长那一档落在起点', () => {
    const wrapper = mountList([port({ at: { kind: 'xy', x: 0.2, y: 0.4 } })])

    selectBy(wrapper, '落点').vm.$emit('update:modelValue', 'perim')

    expect(lastWrite(wrapper)[0]?.at).toEqual({ kind: 'perim', t: 0 })
  })

  it('认不出的落点档不写回', () => {
    const wrapper = mountList([port()])

    selectBy(wrapper, '落点').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('盒内坐标两轴各写各的', async () => {
    const wrapper = mountList([port({ at: { kind: 'xy', x: 0.2, y: 0.4 } })])

    await wrapper.find('[data-test="port-y-p1"]').setValue('0.9')

    expect(lastWrite(wrapper)[0]?.at).toEqual({ kind: 'xy', x: 0.2, y: 0.9 })
  })

  it('周长位置写回', async () => {
    const wrapper = mountList([port()])

    await wrapper.find('[data-test="port-t-p1"]').setValue('0.25')

    expect(lastWrite(wrapper)[0]?.at).toEqual({ kind: 'perim', t: 0.25 })
  })
})

describe('引脚符号', () => {
  it('没有符号时不摆符号那一段', () => {
    expect(mountList([port()]).find('[data-test="pin-length"]').exists()).toBe(
      false,
    )
  })

  // ⚠ 只给形状不给线宽的话，落到 SVG 默认的 1px 与导线对不上，而这既不报错也不像 bug
  it('开了就带一遍看得见的描边与一段几何', async () => {
    const wrapper = mountList([port()])

    await wrapper.find('[data-test="port-marker-p1"] input').setValue(true)
    const marker = lastWrite(wrapper)[0]?.marker

    expect(marker?.strokes[0]?.width).toBeGreaterThan(0)
    expect(marker?.shape.kind).toBe('line')
    expect(marker?.length).toBeGreaterThan(0)
  })

  it('关掉就是没有符号', async () => {
    const wrapper = mountList([
      port({
        marker: {
          shape: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
          strokes: [],
          fill: { kind: 'none' },
          length: 8,
        },
      }),
    ])

    await wrapper.find('[data-test="port-marker-p1"] input').setValue(false)

    expect(lastWrite(wrapper)[0]?.marker).toBeNull()
  })

  it('改符号只改这一条引脚', async () => {
    const wrapper = mountList([
      port(),
      port({
        id: 'p2',
        marker: {
          shape: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
          strokes: [],
          fill: { kind: 'none' },
          length: 8,
        },
      }),
    ])

    await wrapper
      .find('[data-test="port-row-p2"] [data-test="pin-length"]')
      .setValue('12')
    const rows = lastWrite(wrapper)

    expect(rows[1]?.marker?.length).toBe(12)
    expect(rows[0]?.marker).toBeNull()
  })
})
