/**
 * @fileoverview 契约：样式检查器把一份节点样式的整体面摆全，改动只以整份新配置
 * 往上抛；内置样式在面上说清「改一项 = 在本图里落一份覆盖」，而「恢复内置」删的是
 * 那条覆盖，**不是**把预置数据写进文档。
 *
 * ⚠ 写死内置数据的话，预置库将来升级就再也修不到这张图，而用户以为自己已经恢复了。
 * ⚠ 「恢复内置」只该出现在覆盖那一档：自建样式删掉就没了，两档摆同一个按钮会让
 * 用户以为自建的也恢复得回来。
 * ⚠ 端口 usage 只数**用这份样式的节点**上挂着的连线：按全图数的话，「改这个 id
 * 安不安全」这句话就是错的。
 * ⚠ 文本与表格逐键写回一律走合并撤销，合并键带上样式 id：不带的话改完 A 接着改 B，
 * 两笔并进同一帧，撤销一次把两份样式一起退回去。
 */
import { TWIN_2D_BUILTIN_NODE_STYLES, normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ColorField from '@/pages/Twin2dEditor/components/fields/ColorField.vue'
import StyleInspector from '@/pages/Twin2dEditor/components/inspector/StyleInspector.vue'
import { twin2dNodeStyleOf } from '@/pages/Twin2dEditor/scripts/styleOps'

/** 夹具坏了要当场炸，不能悄悄退化成一个空样式。 */
function throwMissing(): never {
  throw new Error('预置库是空的')
}

/** 一份内置样式：预置库里有它，文档里默认没有。 */
const BUILTIN: Twin2dNodeStyle =
  TWIN_2D_BUILTIN_NODE_STYLES[0] ?? throwMissing()

/** 自建那一份：预置库里没有这个 id。 */
const OWN_ID = 'mine'

/** 一份挂着连线的配置：只有 n1 用这份样式，n2 / n3 用的是别的。 */
const USAGE_CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  styles: [{ id: OWN_ID, ports: [{ id: 'p1' }, { id: 'p2' }] }],
  nodes: [
    { id: 'n1', styleId: OWN_ID },
    { id: 'n2', styleId: 'other' },
    { id: 'n3', styleId: 'other' },
  ],
  edges: [
    {
      id: 'e1',
      from: { nodeId: 'n1', portId: 'p1' },
      to: { nodeId: 'n2', portId: 'p1' },
    },
    {
      id: 'e2',
      from: { nodeId: 'n2', portId: 'p2' },
      to: { nodeId: 'n3', portId: 'p2' },
    },
  ],
})

/**
 * 按 id 取当下生效的那一份样式。
 * @param config 整份配置
 * @param id 样式 id
 */
function styleIn(config: Twin2dConfig, id: string): Twin2dNodeStyle {
  const found = twin2dNodeStyleOf(config, id)
  if (found === null) throw new Error(`${id} 解析不出样式`)
  return found
}

/**
 * 挂一份检查器。
 * @param config 整份配置
 * @param id 正在编辑的样式 id
 */
function mountInspector(config: Twin2dConfig, id: string) {
  return mount(StyleInspector, {
    props: { config, nodeStyle: styleIn(config, id), selectedPrim: '' },
  })
}

type Wrapper = ReturnType<typeof mountInspector>

/** 内置那一档：文档里一份样式都没有。 */
function mountBuiltin() {
  return mountInspector(normalizeTwin2dConfig({}), BUILTIN.id)
}

/** 覆盖那一档：文档里压着一份同 id 的。 */
function mountOverride() {
  const config = normalizeTwin2dConfig({
    styles: [{ ...BUILTIN, name: '改过的' }],
  })
  return mountInspector(config, BUILTIN.id)
}

/** 自建那一档的配置：预置库里没有这个 id。 */
function ownConfig(): Twin2dConfig {
  return normalizeTwin2dConfig({
    styles: [
      {
        id: OWN_ID,
        name: '我的换热器',
        category: 'exchanger',
        size: { w: 80, h: 40 },
        ports: [{ id: 'p1' }, { id: 'p2' }],
        prims: [{ id: 'shell', kind: 'box' }],
      },
    ],
  })
}

/** 自建那一档。 */
function mountOwn() {
  return mountInspector(ownConfig(), OWN_ID)
}

function lastChange(wrapper: Wrapper): Twin2dConfig {
  const events = wrapper.emitted('change')
  if (!events?.length) throw new Error('没有抛出改动')
  return events[events.length - 1]?.[0] as Twin2dConfig
}

function lastMerge(wrapper: Wrapper): { config: Twin2dConfig; key: string } {
  const events = wrapper.emitted('merge')
  if (!events?.length) throw new Error('没有抛出合并改动')
  const frame = events[events.length - 1] ?? []
  return { config: frame[0] as Twin2dConfig, key: frame[1] as string }
}

/** 最后一帧合并里那份样式。 */
function mergedStyle(wrapper: Wrapper, id: string): Twin2dNodeStyle {
  return styleIn(lastMerge(wrapper).config, id)
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

/**
 * 数字框：改文本再落定，走的是控件自己的解析与夹取。
 * @param wrapper 挂好的面板
 * @param test 那一格的 data-test
 * @param text 敲进去的文本
 */
async function typeNumber(
  wrapper: Wrapper,
  test: string,
  text: string,
): Promise<void> {
  const input = wrapper.find(`[data-test="${test}"]`)
  await input.setValue(text)
  await input.trigger('change')
}

describe('来路', () => {
  it('身份行摆出样式 id 与还有几个节点在用', () => {
    const wrapper = mountBuiltin()

    expect(wrapper.get('[data-test="style-id"]').text()).toContain(BUILTIN.id)
    expect(wrapper.get('[data-test="style-id"]').text()).toContain('0 个节点')
  })

  // ⚠ 不说这句的话，用户以为自己改的是预置库，而那份覆盖只在这张图里生效
  it('内置那一份在面上说清「改一项就落一份覆盖」', () => {
    const wrapper = mountBuiltin()

    expect(wrapper.get('[data-test="style-builtin"]').text()).toContain('覆盖')
  })

  it('内置那一份还没被覆盖过，所以不给「恢复内置」', () => {
    expect(mountBuiltin().find('[data-test="style-restore"]').exists()).toBe(
      false,
    )
  })

  it('覆盖那一份给「恢复内置」，并说清改动只在这张图里生效', () => {
    const wrapper = mountOverride()

    expect(wrapper.find('[data-test="style-restore"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="style-override"]').text()).toContain(
      '这张图',
    )
  })

  // ⚠ 自建的删掉就没了，摆同一个按钮会让用户以为它也恢复得回来
  it('自建那一份不给「恢复内置」', () => {
    const wrapper = mountOwn()

    expect(wrapper.find('[data-test="style-restore"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="style-custom"]').text()).toContain('自建')
  })

  // ⚠ 写死内置数据的话，预置库将来升级就再也修不到这张图
  it('「恢复内置」删掉的是本图那条覆盖，不是把预置数据写进文档', async () => {
    const wrapper = mountOverride()

    await wrapper.get('[data-test="style-restore"]').trigger('click')
    const next = lastChange(wrapper)

    expect(next.styles.some((style) => style.id === BUILTIN.id)).toBe(false)
    expect(styleIn(next, BUILTIN.id).name).toBe(BUILTIN.name)
  })
})

describe('整体字段', () => {
  it('改名走合并撤销，合并键带着样式 id', async () => {
    const wrapper = mountOwn()

    await wrapper.get('input[data-test="style-name"]').setValue('板换')

    expect(mergedStyle(wrapper, OWN_ID).name).toBe('板换')
    expect(lastMerge(wrapper).key).toBe(`style:${OWN_ID}:name`)
  })

  it('调色板分栏改得动，并写着它不参与渲染', async () => {
    const wrapper = mountOwn()

    await wrapper.get('input[data-test="style-category"]').setValue('vessel')

    expect(mergedStyle(wrapper, OWN_ID).category).toBe('vessel')
    expect(wrapper.text()).toContain('只用于调色板分栏')
  })

  it('缺省尺寸两轴各改各的，另一轴原样带着', async () => {
    const wrapper = mountOwn()

    await typeNumber(wrapper, 'style-w', '120')

    expect(mergedStyle(wrapper, OWN_ID).size).toEqual({ w: 120, h: 40 })
    expect(lastMerge(wrapper).key).toBe(`style:${OWN_ID}:size`)
  })

  // ⚠ 数字框每次失焦都回抛一次当前值，不比一遍就白记一帧撤销
  it('尺寸没变时一帧都不记', async () => {
    const wrapper = mountOwn()

    await typeNumber(wrapper, 'style-w', '80')

    expect(wrapper.emitted('merge')).toBeUndefined()
  })

  it('缺省状态换得了档', () => {
    const wrapper = mountOwn()

    selectBy(wrapper, 'style-status').vm.$emit('update:modelValue', 'hidden')

    expect(lastChange(wrapper).styles[0]?.defaultStatus).toBe('hidden')
  })

  it('缺省状态认不出的取值一个字都不写回', () => {
    const wrapper = mountOwn()

    selectBy(wrapper, 'style-status').vm.$emit('update:modelValue', '瞎填的')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('强调色经取色控件落到样式上', () => {
    const wrapper = mountOwn()

    wrapper.findComponent(ColorField).vm.$emit('update:modelValue', 'slategray')

    expect(mergedStyle(wrapper, OWN_ID).accent).toBe('slategray')
    expect(lastMerge(wrapper).key).toBe(`style:${OWN_ID}:accent`)
  })

  it('取色控件收手时这一段连续输入到此为止', async () => {
    const wrapper = mountOwn()

    wrapper.findComponent(ColorField).vm.$emit('blur')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('endMerge')?.length).toBeGreaterThan(0)
  })

  it('改动一个字都不落在入参那份配置上', async () => {
    const config = ownConfig()
    const wrapper = mountInspector(config, OWN_ID)

    await wrapper.get('input[data-test="style-name"]').setValue('板换')

    expect(config.styles[0]?.name).toBe('我的换热器')
  })
})

describe('端口与槽位', () => {
  it('端口表整份换，走合并撤销', async () => {
    const wrapper = mountOwn()

    await wrapper.get('[data-test="port-add"]').trigger('click')

    expect(mergedStyle(wrapper, OWN_ID).ports).toHaveLength(3)
    expect(lastMerge(wrapper).key).toBe(`style:${OWN_ID}:ports`)
  })

  it('槽位表整份换，走合并撤销', async () => {
    const wrapper = mountOwn()

    await wrapper.get('[data-test="slot-add"]').trigger('click')

    expect(mergedStyle(wrapper, OWN_ID).slots).toHaveLength(1)
    expect(lastMerge(wrapper).key).toBe(`style:${OWN_ID}:slots`)
  })

  // ⚠ 按全图数的话，别的样式上的同名引脚会被算进来，那句「安不安全」就是错的
  it('引脚上挂着几条线只数用这份样式的节点', () => {
    const wrapper = mountInspector(USAGE_CONFIG, OWN_ID)

    expect(wrapper.get('[data-test="port-row-p1"]').text()).toContain(
      '有 1 条连线',
    )
    expect(wrapper.get('[data-test="port-row-p2"]').text()).toContain(
      '还没有连线',
    )
  })

  it('一条线都没挂的引脚也报得出 0，不落回那句通用提示', () => {
    const wrapper = mountOwn()

    expect(wrapper.get('[data-test="port-row-p1"]').text()).toContain(
      '还没有连线',
    )
  })
})

describe('图元树与变体', () => {
  it('图元树摆得出来，树上改出来的整份配置原样往上抛', async () => {
    const wrapper = mountOwn()

    expect(wrapper.find('[data-test="prim-row-shell"]').exists()).toBe(true)
    await wrapper.get('[data-test="prim-remove-shell"]').trigger('click')

    expect(styleIn(lastChange(wrapper), OWN_ID).prims).toHaveLength(0)
  })

  it('图元树上选中的那一枚抛成 pickPrim，画布照它高亮', async () => {
    const wrapper = mountOwn()

    await wrapper.get('[data-test="prim-pick-shell"]').trigger('click')

    expect(wrapper.emitted('pickPrim')).toEqual([['shell']])
  })

  it('选中的那一枚原样喂给图元树，树上那一行跟着标出来', () => {
    const config = ownConfig()
    const wrapper = mount(StyleInspector, {
      props: {
        config,
        nodeStyle: styleIn(config, OWN_ID),
        selectedPrim: 'shell',
      },
    })

    expect(
      wrapper.get('[data-test="prim-pick-shell"]').attributes('aria-pressed'),
    ).toBe('true')
  })

  it('变体那一段没接上时给一行占位，不装成空表', () => {
    const wrapper = mountOwn()

    expect(wrapper.find('[data-test="style-variants-empty"]').exists()).toBe(
      true,
    )
  })

  it('图元字段面由装配层塞进图元树底下', () => {
    const config = ownConfig()
    const wrapper = mount(StyleInspector, {
      props: {
        config,
        nodeStyle: styleIn(config, OWN_ID),
        selectedPrim: 'shell',
      },
      slots: { prim: '<p data-test="prim-slot">图元字段</p>' },
    })

    expect(wrapper.find('[data-test="prim-slot"]').exists()).toBe(true)
  })

  it('变体那一段可以由装配层塞进来', () => {
    const config = normalizeTwin2dConfig({ styles: [{ id: OWN_ID }] })
    const wrapper = mount(StyleInspector, {
      props: { config, nodeStyle: styleIn(config, OWN_ID), selectedPrim: '' },
      slots: { variants: '<p data-test="variants-slot">变体面板</p>' },
    })

    expect(wrapper.find('[data-test="variants-slot"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="style-variants-empty"]').exists()).toBe(
      false,
    )
  })
})
