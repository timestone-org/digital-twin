/**
 * @fileoverview 契约：节点检查器只算配置不碰文档——一步一步的改动走 `change`，
 * 文本与数值框走 `merge`（同一格同键，并成一帧撤销），失焦断段走 `endMerge`；
 * 样式下拉按分栏分组且同 id 以文档为准，旋转四档、翻转两向一档不少。
 *
 * ⚠ 每敲一个字母塞一帧进撤销栈，撤销键就等于废了——所以显示名、强调色与位姿框必须
 * 交出 `merge` 而不是 `change`，且合并键带上节点 id：不带的话，改完 A 的名字接着改
 * B 的会并进同一帧，撤销一次把两个节点一起退回去。
 * ⚠ 重选当前那一档一律不写回：换了新引用却什么都没改，撤销键上就多出一格按了没反应
 * 的空步。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_LABEL_POSITIONS,
  TWIN_2D_NODE_ROTATIONS,
  TWIN_2D_STATUSES,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNode } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NodeInspector from '@/pages/Twin2dEditor/components/inspector/NodeInspector.vue'

/** 一份两节点的配置：`n1` 引预置样式，`n2` 的样式悬空。 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  version: 1,
  canvas: { width: 800, height: 600, grid: 20 },
  styles: [
    {
      id: 'circuit-resistor',
      name: '改过名的电阻',
      category: '',
      ports: [
        { id: '1', name: '进' },
        { id: '2', name: '出' },
      ],
      prims: [{ id: 'body', kind: 'vec', shape: { kind: 'rect' } }],
    },
  ],
  nodes: [
    {
      id: 'n1',
      styleId: 'circuit-resistor',
      x: 40,
      y: 60,
      label: '电阻',
      tags: { subtype: 'solar' },
    },
    { id: 'n2', styleId: 'no-such-style', x: 200, y: 0 },
  ],
})

/**
 * 按 id 取一个节点。
 * @param id 节点 id
 * @param config 从哪份配置里取
 */
function nodeOf(id: string, config: Twin2dConfig = CONFIG): Twin2dNode {
  const node = config.nodes.find((item) => item.id === id)
  if (node === undefined) throw new Error(`没有 ${id} 这个节点`)
  return node
}

const N1 = nodeOf('n1')

function mountInspector(node: Twin2dNode, config: Twin2dConfig = CONFIG) {
  return mount(NodeInspector, { props: { node, config } })
}

type Wrapper = ReturnType<typeof mountInspector>

/** 一步一帧那一路交出来的整份配置。 */
function lastChange(wrapper: Wrapper): Twin2dConfig {
  const events = wrapper.emitted('change')
  if (!events?.length) throw new Error('没有一步一帧的写入')
  return events[events.length - 1]?.[0] as Twin2dConfig
}

/** 并成一帧那一路交出来的配置与合并键。 */
function lastMerge(wrapper: Wrapper): [Twin2dConfig, string] {
  const events = wrapper.emitted('merge')
  if (!events?.length) throw new Error('没有并成一帧的写入')
  const last = events[events.length - 1]
  return [last?.[0] as Twin2dConfig, last?.[1] as string]
}

/** 改完之后的那个节点。 */
function changedNode(wrapper: Wrapper, id = 'n1'): Twin2dNode {
  return nodeOf(id, lastChange(wrapper))
}

/**
 * 按 `data-test` 取那一个下拉——同一面板上有好几个，按序号取会跟着版式一起漂。
 * @param wrapper 挂好的检查器
 * @param test 那一格的 data-test
 */
function selectBy(wrapper: Wrapper, test: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.attributes('data-test') === test)
  if (found === undefined) throw new Error(`没有 ${test} 这个下拉`)
  return found
}

/**
 * 一个下拉摆出来的全部选项。
 * @param wrapper 挂好的检查器
 * @param test 那一格的 data-test
 */
function optionsOf(
  wrapper: Wrapper,
  test: string,
): readonly { value: string; label: string; disabled?: boolean }[] {
  return selectBy(wrapper, test).props('options')
}

describe('身份与样式', () => {
  it('把节点 id 亮出来', () => {
    expect(mountInspector(N1).find('[data-test="node-id"]').text()).toContain(
      'n1',
    )
  })

  it('样式下拉按分栏分组，组标题选不中', () => {
    const options = optionsOf(mountInspector(N1), 'node-style')
    const headers = options.filter((option) => option.disabled === true)

    expect(headers.length).toBeGreaterThan(1)
    expect(headers.map((header) => header.label)).toContain('热源')
  })

  it('组标题排在它那一组的前头', () => {
    const options = optionsOf(mountInspector(N1), 'node-style')
    const first = options[0]

    expect(first?.disabled).toBe(true)
  })

  it('预置库里的样式一个不少', () => {
    const values = optionsOf(mountInspector(N1), 'node-style').map(
      (option) => option.value,
    )

    for (const style of TWIN_2D_BUILTIN_NODE_STYLES) {
      expect(values).toContain(style.id)
    }
  })

  // ⚠ 反过来拿预置库盖掉文档，会把用户整库替换写进去的改动静默还原
  it('同 id 的样式以文档那一份为准，且只出现一次', () => {
    const options = optionsOf(mountInspector(N1), 'node-style').filter(
      (option) => option.value === 'circuit-resistor',
    )

    expect(options).toEqual([
      { value: 'circuit-resistor', label: '改过名的电阻' },
    ])
  })

  it('没登记的分栏名原样当组标题', () => {
    const config = normalizeTwin2dConfig({
      version: 1,
      canvas: { width: 800, height: 600, grid: 20 },
      styles: [{ id: 'mine', name: '自建件', category: '工艺' }],
      nodes: [{ id: 'n1', styleId: 'mine' }],
    })
    const labels = optionsOf(
      mountInspector(nodeOf('n1', config), config),
      'node-style',
    )
      .filter((option) => option.disabled === true)
      .map((header) => header.label)

    expect(labels).toContain('工艺')
  })

  it('没分栏的自建样式归「其他」', () => {
    const labels = optionsOf(mountInspector(N1), 'node-style')
      .filter((option) => option.disabled === true)
      .map((header) => header.label)

    expect(labels).toContain('其他')
  })

  it('换样式落成一步一帧', () => {
    const wrapper = mountInspector(N1)

    selectBy(wrapper, 'node-style').vm.$emit(
      'update:modelValue',
      'circuit-ground',
    )

    expect(changedNode(wrapper).styleId).toBe('circuit-ground')
  })

  it('重选当前这一个不写回', () => {
    const wrapper = mountInspector(N1)

    selectBy(wrapper, 'node-style').vm.$emit(
      'update:modelValue',
      'circuit-resistor',
    )

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  // ⚠ 组标题是一条禁用项，但它的取值一旦被写回去，这个节点就再也画不出来
  it('组标题那一行的取值不写回', () => {
    const wrapper = mountInspector(N1)
    const header = optionsOf(wrapper, 'node-style').find(
      (option) => option.disabled === true,
    )

    selectBy(wrapper, 'node-style').vm.$emit(
      'update:modelValue',
      header?.value ?? '',
    )

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('样式悬空时明说图上画不出它', () => {
    const wrapper = mountInspector(nodeOf('n2'))

    expect(wrapper.text()).toContain('不在册')
  })

  it('样式在册时不报那一句', () => {
    expect(mountInspector(N1).text()).not.toContain('不在册')
  })

  // ⚠ 右栏画着一个已经被删掉的东西时，改哪一项都不该写回去
  it('节点不在这份配置里就一个字都不写', () => {
    const wrapper = mountInspector({ ...N1, id: 'gone' })

    selectBy(wrapper, 'node-style').vm.$emit(
      'update:modelValue',
      'circuit-ground',
    )

    expect(wrapper.emitted('change')).toBeUndefined()
    expect(wrapper.emitted('merge')).toBeUndefined()
  })
})

describe('显示名与位姿', () => {
  it('显示名逐键写入并成一帧，键钉在这个节点这一格上', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('input[data-test="node-label"]').setValue('电阻 R1')

    const [config, key] = lastMerge(wrapper)
    expect(nodeOf('n1', config).label).toBe('电阻 R1')
    expect(key).toBe('node:n1:label')
  })

  // ⚠ 不带节点 id 的话，改完 A 接着改 B 会并进同一帧
  it('换个节点改名，合并键跟着换', async () => {
    const wrapper = mountInspector(nodeOf('n2'))

    await wrapper.find('input[data-test="node-label"]').setValue('接地')

    expect(lastMerge(wrapper)[1]).toBe('node:n2:label')
  })

  it('显示名不 trim', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('input[data-test="node-label"]').setValue('电阻 ')

    expect(nodeOf('n1', lastMerge(wrapper)[0]).label).toBe('电阻 ')
  })

  it('焦点离开就断段', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('[data-test="node-inspector"]').trigger('focusout')

    expect(wrapper.emitted('endMerge')).toHaveLength(1)
  })

  it('显示名位置六档一档不少', () => {
    const values = optionsOf(mountInspector(N1), 'node-label-pos').map(
      (option) => option.value,
    )

    expect(values).toEqual([...TWIN_2D_LABEL_POSITIONS])
  })

  it('换显示名位置落成一步一帧', () => {
    const wrapper = mountInspector(N1)

    selectBy(wrapper, 'node-label-pos').vm.$emit('update:modelValue', 'inside')

    expect(changedNode(wrapper).labelPos).toBe('inside')
  })

  it('重选当前这一档与认不出的档位都不写回', () => {
    const wrapper = mountInspector(N1)

    selectBy(wrapper, 'node-label-pos').vm.$emit('update:modelValue', 'bottom')
    selectBy(wrapper, 'node-label-pos').vm.$emit('update:modelValue', 'nope')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it.each([
    ['node-x', 'x', 120],
    ['node-y', 'y', 90],
    ['node-w', 'w', 64],
    ['node-h', 'h', 48],
  ] as const)('位姿的 %s 一格写回并成同一段', async (test, field, value) => {
    const wrapper = mountInspector(N1)

    await wrapper.find(`input[data-test="${test}"]`).setValue(String(value))

    const [config, key] = lastMerge(wrapper)
    expect(nodeOf('n1', config)[field]).toBe(value)
    expect(key).toBe('node:n1:geometry')
  })

  it.each([
    ['node-x', 'x'],
    ['node-y', 'y'],
    ['node-w', 'w'],
    ['node-h', 'h'],
  ] as const)('位姿的 %s 清空按 0 处理', async (test, field) => {
    const wrapper = mountInspector({ ...N1, x: 5, y: 5, w: 5, h: 5 })

    await wrapper.find(`input[data-test="${test}"]`).setValue('')

    expect(nodeOf('n1', lastMerge(wrapper)[0])[field]).toBe(0)
  })
})

describe('朝向与状态', () => {
  it('旋转四档一档不少', () => {
    const wrapper = mountInspector(N1)

    for (const deg of TWIN_2D_NODE_ROTATIONS) {
      expect(wrapper.find(`[data-test="node-rotate-${deg}"]`).exists()).toBe(
        true,
      )
    }
  })

  it('当前那一档按下去', () => {
    const wrapper = mountInspector({ ...N1, rotate: 180 })

    expect(
      wrapper.find('[data-test="node-rotate-180"]').attributes('aria-pressed'),
    ).toBe('true')
  })

  it('点一档落成一步一帧', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('[data-test="node-rotate-270"]').trigger('click')

    expect(changedNode(wrapper).rotate).toBe(270)
  })

  it('点当前那一档不写回', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('[data-test="node-rotate-0"]').trigger('click')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('两向翻转各自落成一步一帧', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('[data-test="node-flip-x"] input').setValue(true)
    expect(changedNode(wrapper).flipX).toBe(true)

    await wrapper.find('[data-test="node-flip-y"] input').setValue(true)
    expect(changedNode(wrapper).flipY).toBe(true)
  })

  it('静态状态四档加一档「按样式」', () => {
    const values = optionsOf(mountInspector(N1), 'node-status').map(
      (option) => option.value,
    )

    expect(values).toEqual(['', ...TWIN_2D_STATUSES])
  })

  it('换静态状态落成一步一帧', () => {
    const wrapper = mountInspector(N1)

    selectBy(wrapper, 'node-status').vm.$emit('update:modelValue', 'alarm')

    expect(changedNode(wrapper).status).toBe('alarm')
  })

  it('认不出的状态一律当「按样式」', () => {
    const wrapper = mountInspector({ ...N1, status: 'alarm' })

    selectBy(wrapper, 'node-status').vm.$emit('update:modelValue', 'nope')

    expect(changedNode(wrapper).status).toBe('')
  })

  it('重选当前这一档不写回', () => {
    const wrapper = mountInspector(N1)

    selectBy(wrapper, 'node-status').vm.$emit('update:modelValue', '')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('强调色逐键写入并成一帧', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('.dt-t2-color input[type="text"]').setValue('tomato')

    const [config, key] = lastMerge(wrapper)
    expect(nodeOf('n1', config).accent).toBe('tomato')
    expect(key).toBe('node:n1:accent')
  })
})

describe('分派给四段列表', () => {
  it('标签那一段的写入落到节点的 tags 上', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('[data-test="tag-remove-subtype"]').trigger('click')

    expect(changedNode(wrapper).tags).toEqual({})
  })

  it('标签那一段的逐键输入带上节点 id 后并成一帧', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('input[data-test="tag-value-subtype"]').setValue('steam')

    const [config, key] = lastMerge(wrapper)
    expect(nodeOf('n1', config).tags).toEqual({ subtype: 'steam' })
    expect(key).toBe('node:n1:tag:subtype')
  })

  it('传感器那一段的写入同时落到 layers 与 slots 上', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('[data-test="sensor-toggle-TT"] input').setValue(true)

    const node = changedNode(wrapper)
    expect(node.layers.map((prim) => prim.id)).toEqual(['sensor-tt-pill'])
    expect(node.slots.map((slot) => slot.key)).toEqual(['temperature_c'])
  })

  it('引脚那一段的写入落到节点的 ports 上', async () => {
    const wrapper = mountInspector(N1)

    await wrapper.find('[data-test="port-add"]').trigger('click')

    expect(changedNode(wrapper).ports).toHaveLength(1)
  })

  it('引脚那一段拿得到样式里的引脚', () => {
    const wrapper = mountInspector(N1)

    expect(wrapper.find('[data-test="port-override"]').exists()).toBe(true)
  })

  it('样式悬空时引脚与图元覆盖两段都拿到空表', () => {
    const wrapper = mountInspector(nodeOf('n2'))

    expect(wrapper.find('[data-test="port-override"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="patch-add"]').exists()).toBe(false)
  })

  it('图元覆盖那一段的写入落到节点的 patch 上', () => {
    const wrapper = mountInspector(N1)
    const target = optionsOf(wrapper, 'patch-add')[0]?.value ?? ''

    selectBy(wrapper, 'patch-add').vm.$emit('update:modelValue', target)

    expect(Object.keys(changedNode(wrapper).patch)).toEqual([target])
  })
})
