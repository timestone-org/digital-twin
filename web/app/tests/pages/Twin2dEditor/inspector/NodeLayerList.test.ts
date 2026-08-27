/**
 * @fileoverview 契约：节点级追加图元与覆盖补丁——传感器药丸不在这一段里露面，
 * 覆盖是**浅覆盖**所以清一格等于删键，覆盖入口按摊平后的样式图元树列。
 *
 * ⚠ 药丸是「图元 + 读数槽位」两半，在这一段删掉图元那一半会留下一条没人读的槽位，
 * 而界面上看不出来——所以这一段一律跳过它们。
 * ⚠ 「不覆盖」与「覆盖成缺省值」是两回事：清一格写一个缺省值进去，会把样式改过的
 * 那一格一起按回缺省，而这一步零报错。
 */
import {
  TWIN_2D_SENSOR_DEFAULT_AT,
  TWIN_2D_SENSOR_DEFS,
  normalizePrims,
  twin2dSensorPill,
} from '@dt/twin2d'
import type { Twin2dPrim, Twin2dPrimPatch } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PlacementField from '@/pages/Twin2dEditor/components/fields/PlacementField.vue'
import NodeLayerList from '@/pages/Twin2dEditor/components/inspector/NodeLayerList.vue'

/** 一枚温度药丸；它不该在这一段里露面。 */
const PILL = twin2dSensorPill(
  TWIN_2D_SENSOR_DEFS[0],
  TWIN_2D_SENSOR_DEFAULT_AT,
  'sensor-tt',
)

/** 两枚自己加的图元。 */
const LAYERS: readonly Twin2dPrim[] = normalizePrims(
  [
    { id: 'note', kind: 'txt', src: { kind: 'lit', text: '备注' } },
    { id: 'dot', kind: 'vec', shape: { kind: 'rect' } },
  ],
  0,
)

/** 样式的图元树：一枚 box 套两枚子图元，用来验摊平。 */
const STYLE_PRIMS: readonly Twin2dPrim[] = normalizePrims(
  [
    {
      id: 'shell',
      kind: 'box',
      children: [
        { id: 'title', kind: 'txt', src: { kind: 'label' } },
        { id: 'glyph', kind: 'ico', src: { kind: 'none' } },
      ],
    },
  ],
  0,
)

function mountList(
  layers: readonly Twin2dPrim[] = LAYERS,
  patch: Readonly<Record<string, Twin2dPrimPatch>> = {},
  stylePrims: readonly Twin2dPrim[] = STYLE_PRIMS,
) {
  return mount(NodeLayerList, { props: { layers, patch, stylePrims } })
}

type Wrapper = ReturnType<typeof mountList>

/** 最后一次写回的三样：追加图元、覆盖补丁、合并键。 */
function lastUpdate(
  wrapper: Wrapper,
): [
  readonly Twin2dPrim[],
  Readonly<Record<string, Twin2dPrimPatch>>,
  string | null,
] {
  const events = wrapper.emitted('update')
  if (!events?.length) throw new Error('没有写回图元')
  const last = events[events.length - 1]
  return [
    last?.[0] as readonly Twin2dPrim[],
    last?.[1] as Readonly<Record<string, Twin2dPrimPatch>>,
    last?.[2] as string | null,
  ]
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

describe('追加图元', () => {
  it('自己加的逐条摆出来', () => {
    const wrapper = mountList()

    expect(wrapper.find('[data-test="layer-row-note"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="layer-row-dot"]').exists()).toBe(true)
  })

  // ⚠ 在这一段删掉药丸的图元那一半，读数槽位会留在节点上永远没人读
  it('传感器药丸不在这一段里露面', () => {
    const wrapper = mountList([PILL])

    expect(
      wrapper.find('[data-test="layer-row-sensor-tt-pill"]').exists(),
    ).toBe(false)
    expect(wrapper.find('[data-test="layer-empty"]').exists()).toBe(true)
  })

  it('一枚都没有时给一行空态', () => {
    expect(mountList([]).find('[data-test="layer-empty"]').exists()).toBe(true)
  })

  it('挪落点并成一帧，键钉在这一枚上', () => {
    const wrapper = mountList()
    const field = wrapper
      .findAllComponents(PlacementField)
      .find((item) => item.attributes('data-test') === 'layer-at-note')
    if (field === undefined) throw new Error('没有 note 那一枚的摆位面')

    field.vm.$emit('update:modelValue', {
      kind: 'anchor',
      anchor: 'c',
      dx: 0,
      dy: 0,
    })

    const [layers, , mergeKey] = lastUpdate(wrapper)
    expect(layers.find((prim) => prim.id === 'note')?.at).toEqual({
      kind: 'anchor',
      anchor: 'c',
      dx: 0,
      dy: 0,
    })
    expect(mergeKey).toBe('layer-at:note')
  })

  it('改不透明度并成一帧', async () => {
    const wrapper = mountList()

    await wrapper.find('input[data-test="layer-opacity-dot"]').setValue('0.4')

    const [layers, , mergeKey] = lastUpdate(wrapper)
    expect(layers.find((prim) => prim.id === 'dot')?.opacity).toBe(0.4)
    expect(mergeKey).toBe('layer-opacity:dot')
  })

  it('清空不透明度按不透明处理', async () => {
    const wrapper = mountList()

    await wrapper.find('input[data-test="layer-opacity-dot"]').setValue('')

    expect(
      lastUpdate(wrapper)[0].find((prim) => prim.id === 'dot')?.opacity,
    ).toBe(1)
  })

  it('删一枚只删那一枚，药丸原样留着', async () => {
    const wrapper = mountList([...LAYERS, PILL])

    await wrapper.find('[data-test="layer-remove-note"]').trigger('click')

    const [layers, , mergeKey] = lastUpdate(wrapper)
    expect(layers.map((prim) => prim.id)).toEqual(['dot', PILL.id])
    expect(mergeKey).toBeNull()
  })
})

describe('覆盖补丁', () => {
  it('覆盖入口按摊平后的样式图元树列，box 的子树也在', () => {
    const options: readonly { value: string }[] = selectBy(
      mountList(),
      'patch-add',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual([
      'shell',
      'title',
      'glyph',
    ])
  })

  it('覆盖入口不列已经覆盖过的那些', () => {
    const options: readonly { value: string }[] = selectBy(
      mountList(LAYERS, { title: {} }),
      'patch-add',
    ).props('options')

    expect(options.map((option) => option.value)).toEqual(['shell', 'glyph'])
  })

  it('样式里的都覆盖过了就不摆覆盖入口', () => {
    const wrapper = mountList(LAYERS, { shell: {}, title: {}, glyph: {} })

    expect(wrapper.find('[data-test="patch-add"]').exists()).toBe(false)
  })

  it('新增一条覆盖是一条空补丁', () => {
    const wrapper = mountList()

    selectBy(wrapper, 'patch-add').vm.$emit('update:modelValue', 'title')

    expect(lastUpdate(wrapper)[1]).toEqual({ title: {} })
  })

  it('重复新增同一条不写回', () => {
    const wrapper = mountList(LAYERS, { title: {} })

    selectBy(wrapper, 'patch-add').vm.$emit('update:modelValue', 'title')

    expect(wrapper.emitted('update')).toBeUndefined()
  })

  it('覆盖成强制隐藏', () => {
    const wrapper = mountList(LAYERS, { title: {} })

    selectBy(wrapper, 'patch-hidden-title').vm.$emit(
      'update:modelValue',
      'hide',
    )

    expect(lastUpdate(wrapper)[1]).toEqual({ title: { hidden: true } })
  })

  it('覆盖成强制显示', () => {
    const wrapper = mountList(LAYERS, { title: { hidden: true } })

    selectBy(wrapper, 'patch-hidden-title').vm.$emit(
      'update:modelValue',
      'show',
    )

    expect(lastUpdate(wrapper)[1]).toEqual({ title: { hidden: false } })
  })

  // ⚠ 写一个缺省值进去会把样式改过的那一格一起按回缺省
  it('不覆盖那一档是把这个键整个去掉', () => {
    const wrapper = mountList(LAYERS, { title: { hidden: true, z: 3 } })

    selectBy(wrapper, 'patch-hidden-title').vm.$emit('update:modelValue', '')

    expect(lastUpdate(wrapper)[1]).toEqual({ title: { z: 3 } })
  })

  it('三档回显跟着补丁走', () => {
    const wrapper = mountList(LAYERS, {
      shell: {},
      title: { hidden: true },
      glyph: { hidden: false },
    })

    expect(selectBy(wrapper, 'patch-hidden-shell').props('modelValue')).toBe('')
    expect(selectBy(wrapper, 'patch-hidden-title').props('modelValue')).toBe(
      'hide',
    )
    expect(selectBy(wrapper, 'patch-hidden-glyph').props('modelValue')).toBe(
      'show',
    )
  })

  it('覆盖不透明度并成一帧', async () => {
    const wrapper = mountList(LAYERS, { title: {} })

    await wrapper.find('input[data-test="patch-opacity-title"]').setValue('0.3')

    expect(lastUpdate(wrapper)).toEqual([
      LAYERS,
      { title: { opacity: 0.3 } },
      'patch-opacity:title',
    ])
  })

  it('清空不透明度是把这个键整个去掉', async () => {
    const wrapper = mountList(LAYERS, { title: { opacity: 0.3, z: 2 } })

    await wrapper.find('input[data-test="patch-opacity-title"]').setValue('')

    expect(lastUpdate(wrapper)[1]).toEqual({ title: { z: 2 } })
  })

  it('撤掉整条覆盖只撤那一条', async () => {
    const wrapper = mountList(LAYERS, { title: { hidden: true }, glyph: {} })

    await wrapper.find('[data-test="patch-clear-title"]').trigger('click')

    expect(Object.keys(lastUpdate(wrapper)[1])).toEqual(['glyph'])
  })

  it('样式悬空时覆盖入口一条都不列', () => {
    const wrapper = mountList(LAYERS, {}, [])

    expect(wrapper.find('[data-test="patch-add"]').exists()).toBe(false)
  })

  it('焦点离开就断段', async () => {
    const wrapper = mountList(LAYERS, { title: {} })

    await wrapper.find('[data-test="patch-row-title"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
