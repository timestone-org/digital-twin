/**
 * @fileoverview 契约：节点上的引脚——同 id 就是**覆盖**样式里那一个（不是另加一个），
 * 落点两档换来换去取的是归一化缺省，引脚名逐键并成一帧撤销。
 *
 * ⚠ 换档缺省抄一份在面板里，就会与 `normalizePortAt` 漂开：换的那一档存一次再读回来
 * 悄悄变样，而这一步零报错。下面按归一化那一份逐字对。
 * ⚠ 覆盖入口列的是「样式里还没被覆盖的那些」：列了已覆盖的，点一下就会往 `ports` 里
 * 塞第二条同 id，归一化只留最先一条，用户改的那一条被无声丢弃。
 */
import {
  TWIN_2D_PORT_DIRS,
  TWIN_2D_PORT_SIDES,
  normalizePort,
} from '@dt/twin2d'
import type { Twin2dPort } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NodePortList from '@/pages/Twin2dEditor/components/inspector/NodePortList.vue'

/**
 * 造一条端口；缺省一律走归一化那一份。
 * @param patch 要盖掉的字段
 */
function makePort(patch: Partial<Twin2dPort> & { id: string }): Twin2dPort {
  const port = normalizePort(patch)
  if (port === null) throw new Error('造不出这条端口')
  return { ...port, ...patch }
}

const STYLE_PORTS: readonly Twin2dPort[] = [
  makePort({ id: '1', name: '进', at: { kind: 'perim', t: 0.25 } }),
  makePort({ id: '2', name: '出', at: { kind: 'perim', t: 0.75 } }),
]

function mountList(
  ports: readonly Twin2dPort[] = [],
  stylePorts: readonly Twin2dPort[] = STYLE_PORTS,
) {
  return mount(NodePortList, {
    props: { modelValue: ports, stylePorts },
  })
}

type Wrapper = ReturnType<typeof mountList>

/** 最后一次写回的端口表与合并键。 */
function lastUpdate(wrapper: Wrapper): [readonly Twin2dPort[], string | null] {
  const events = wrapper.emitted('update')
  if (!events?.length) throw new Error('没有写回引脚')
  const last = events[events.length - 1]
  return [last?.[0] as readonly Twin2dPort[], last?.[1] as string | null]
}

/**
 * 写回之后的某一条。
 * @param wrapper 挂好的面板
 * @param id 这一条的 id
 */
function writtenPort(wrapper: Wrapper, id: string): Twin2dPort {
  const port = lastUpdate(wrapper)[0].find((item) => item.id === id)
  if (port === undefined) throw new Error(`写回的端口表里没有 ${id}`)
  return port
}

/**
 * 按 `data-test` 取那一个下拉。
 * @param wrapper 挂好的面板
 * @param test 那一格的 data-test
 */
function selectBy(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

describe('增删与覆盖', () => {
  it('一条都没有时给一行空态', () => {
    expect(mountList().find('[data-test="port-empty"]').exists()).toBe(true)
  })

  it('追加的引脚落在周长起点、朝向待解析', async () => {
    const wrapper = mountList()

    await wrapper.find('[data-test="port-add"]').trigger('click')

    const [ports, mergeKey] = lastUpdate(wrapper)
    expect(ports).toHaveLength(1)
    expect(ports[0]?.at).toEqual({ kind: 'perim', t: 0 })
    expect(ports[0]?.side).toBe('auto')
    expect(mergeKey).toBeNull()
  })

  it('追加两条不重名', async () => {
    const wrapper = mountList([makePort({ id: 'port-1' })])

    await wrapper.find('[data-test="port-add"]').trigger('click')

    const [ports] = lastUpdate(wrapper)
    expect(new Set(ports.map((port) => port.id)).size).toBe(ports.length)
  })

  it('覆盖入口只列样式里还没被覆盖的那些', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    const options: readonly { value: string }[] = selectBy(
      wrapper,
      'port-override',
    ).props('options')
    expect(options.map((option) => option.value)).toEqual(['2'])
  })

  it('没名字的样式引脚在覆盖入口里退回显示 id', () => {
    const wrapper = mountList([], [makePort({ id: 'GND' })])

    const options: readonly { label: string }[] = selectBy(
      wrapper,
      'port-override',
    ).props('options')
    expect(options.map((option) => option.label)).toEqual(['GND'])
  })

  it('样式里的都被覆盖了就不摆覆盖入口', () => {
    const wrapper = mountList([makePort({ id: '1' }), makePort({ id: '2' })])

    expect(wrapper.find('[data-test="port-override"]').exists()).toBe(false)
  })

  it('覆盖一条就把样式里那一份原样抄进来', () => {
    const wrapper = mountList()

    selectBy(wrapper, 'port-override').vm.$emit('update:modelValue', '2')

    expect(writtenPort(wrapper, '2').at).toEqual({ kind: 'perim', t: 0.75 })
  })

  it('覆盖一条样式里没有的 id 不写回', () => {
    const wrapper = mountList()

    selectBy(wrapper, 'port-override').vm.$emit('update:modelValue', 'gone')

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('覆盖来的那一条标出来源', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    expect(wrapper.find('[data-test="port-row-1"]').text()).toContain(
      '覆盖样式引脚',
    )
  })

  it('自己追加的那一条不标成覆盖', () => {
    const wrapper = mountList([makePort({ id: 'port-1' })])

    expect(wrapper.find('[data-test="port-row-port-1"]').text()).not.toContain(
      '覆盖样式引脚',
    )
  })

  it('删一条只删那一条', async () => {
    const wrapper = mountList([makePort({ id: '1' }), makePort({ id: '2' })])

    await wrapper.find('[data-test="port-remove-1"]').trigger('click')

    expect(lastUpdate(wrapper)[0].map((port) => port.id)).toEqual(['2'])
  })
})

describe('逐格改', () => {
  it('引脚名逐键并成一帧，键钉在这一条上', async () => {
    const wrapper = mountList([makePort({ id: '1' })])

    await wrapper.find('input[data-test="port-name-1"]').setValue('GND')

    expect(writtenPort(wrapper, '1').name).toBe('GND')
    expect(lastUpdate(wrapper)[1]).toBe('port-name:1')
  })

  it('方向四档一档不少', () => {
    const options: readonly { value: string }[] = selectBy(
      mountList([makePort({ id: '1' })]),
      'port-dir-1',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_PORT_DIRS,
    ])
  })

  it('出线朝向四档加一档自动', () => {
    const options: readonly { value: string }[] = selectBy(
      mountList([makePort({ id: '1' })]),
      'port-side-1',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      ...TWIN_2D_PORT_SIDES,
    ])
  })

  it('换方向落成一步一帧', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    selectBy(wrapper, 'port-dir-1').vm.$emit('update:modelValue', 'out')

    expect(writtenPort(wrapper, '1').dir).toBe('out')
  })

  it('认不出的方向不写回', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    selectBy(wrapper, 'port-dir-1').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('换朝向落成一步一帧', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    selectBy(wrapper, 'port-side-1').vm.$emit('update:modelValue', 'left')

    expect(writtenPort(wrapper, '1').side).toBe('left')
  })

  it('认不出的朝向不写回', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    selectBy(wrapper, 'port-side-1').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  // ⚠ 缺省抄一份就会与归一化漂开，换的那一档存一次再读回来悄悄变样
  it('换成盒内坐标那一档取的是归一化缺省', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    selectBy(wrapper, 'port-at-kind-1').vm.$emit('update:modelValue', 'xy')

    expect(writtenPort(wrapper, '1').at).toEqual(
      normalizePort({ id: '1', at: { kind: 'xy' } })?.at,
    )
  })

  it('换回沿周长那一档取的是归一化缺省', () => {
    const wrapper = mountList([
      makePort({ id: '1', at: { kind: 'xy', x: 0.2, y: 0.3 } }),
    ])

    selectBy(wrapper, 'port-at-kind-1').vm.$emit('update:modelValue', 'perim')

    expect(writtenPort(wrapper, '1').at).toEqual(
      normalizePort({ id: '1', at: { kind: 'perim' } })?.at,
    )
  })

  it('认不出的落点档位不写回', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    selectBy(wrapper, 'port-at-kind-1').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('周长那一档只摆一个位置框', () => {
    const wrapper = mountList([makePort({ id: '1' })])

    expect(wrapper.find('input[data-test="port-t-1"]').exists()).toBe(true)
    expect(wrapper.find('input[data-test="port-x-1"]').exists()).toBe(false)
  })

  it('挪周长位置并成一帧', async () => {
    const wrapper = mountList([makePort({ id: '1' })])

    await wrapper.find('input[data-test="port-t-1"]').setValue('0.5')

    expect(writtenPort(wrapper, '1').at).toEqual({ kind: 'perim', t: 0.5 })
    expect(lastUpdate(wrapper)[1]).toBe('port-at:1')
  })

  it.each([
    ['port-x-1', { kind: 'xy', x: 0.8, y: 0.3 }],
    ['port-y-1', { kind: 'xy', x: 0.2, y: 0.8 }],
  ] as const)('挪盒内坐标的 %s，另一轴原样带着', async (test, expected) => {
    const wrapper = mountList([
      makePort({ id: '1', at: { kind: 'xy', x: 0.2, y: 0.3 } }),
    ])

    await wrapper.find(`input[data-test="${test}"]`).setValue('0.8')

    expect(writtenPort(wrapper, '1').at).toEqual(expected)
  })

  it.each([
    ['port-x-1', { kind: 'xy', x: 0, y: 0.3 }],
    ['port-y-1', { kind: 'xy', x: 0.2, y: 0 }],
  ] as const)('盒内坐标的 %s 清空按 0 处理', async (test, expected) => {
    const wrapper = mountList([
      makePort({ id: '1', at: { kind: 'xy', x: 0.2, y: 0.3 } }),
    ])

    await wrapper.find(`input[data-test="${test}"]`).setValue('')

    expect(writtenPort(wrapper, '1').at).toEqual(expected)
  })

  it('改一条不动同一份里的另一条', async () => {
    const wrapper = mountList([
      makePort({ id: '1', name: '进' }),
      makePort({ id: '2', name: '出' }),
    ])

    await wrapper.find('input[data-test="port-name-1"]').setValue('GND')

    expect(writtenPort(wrapper, '2').name).toBe('出')
  })

  it('周长位置清空按 0 处理', async () => {
    const wrapper = mountList([
      makePort({ id: '1', at: { kind: 'perim', t: 0.4 } }),
    ])

    await wrapper.find('input[data-test="port-t-1"]').setValue('')

    expect(writtenPort(wrapper, '1').at).toEqual({ kind: 'perim', t: 0 })
  })

  it('显示引脚名落成一步一帧', async () => {
    const wrapper = mountList([makePort({ id: '1' })])

    await wrapper.find('[data-test="port-show-name-1"] input').setValue(true)

    expect(writtenPort(wrapper, '1').showName).toBe(true)
    expect(lastUpdate(wrapper)[1]).toBeNull()
  })

  it('焦点离开就断段', async () => {
    const wrapper = mountList([makePort({ id: '1' })])

    await wrapper.find('[data-test="port-row-1"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
