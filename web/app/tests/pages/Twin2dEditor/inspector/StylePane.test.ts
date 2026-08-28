/**
 * @fileoverview 契约：样式那一栏的装配——两条样式轴各自分派到自己那一副面，
 * `StyleInspector` 留的图元与变体两个插槽真的被填上，改动一律整份新配置往上抛。
 *
 * ⚠ 收的是**当下生效**的那一份样式：喂预置库那一份会把已有的覆盖整个抹掉，而界面上
 * 只表现为「刚才改的几项一起没了」（§13.4）。
 * ⚠ 图元与变体逐键写回走**合并撤销**，合并键带上样式 id 与那一枚的身份：不带的话
 * 改完 A 接着改 B，两笔会并进同一帧。
 * ⚠ 顶上那张预览是「刚新建、画布上还没有节点在用的样式」唯一看得见的地方，缺了它
 * 用户只能先往画布上拖一个才知道自己配出了什么。连线样式那条轴上没有它——预览画的
 * 是一个节点，那条轴上没有东西可画。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dPrim, Twin2dVariant } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Twin2dStylePreview from '@/pages/Twin2dEditor/components/Twin2dStylePreview.vue'
import PrimFields from '@/pages/Twin2dEditor/components/inspector/PrimFields.vue'
import StyleInspector from '@/pages/Twin2dEditor/components/inspector/StyleInspector.vue'
import StylePane from '@/pages/Twin2dEditor/components/inspector/StylePane.vue'
import VariantFields from '@/pages/Twin2dEditor/components/inspector/VariantFields.vue'
import type { Twin2dStyleFocus } from '@/pages/Twin2dEditor/scripts/editorSelection'

const NODE_FOCUS: Twin2dStyleFocus = { kind: 'styles', id: 'st' }
const EDGE_FOCUS: Twin2dStyleFocus = { kind: 'edgeStyles', id: 'wire' }

const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  styles: [
    {
      id: 'st',
      name: '换热器',
      prims: [{ id: 'b1', kind: 'box', children: [{ id: 't1', kind: 'txt' }] }],
      variants: [
        { id: 'v1', when: { kind: 'status', in: ['alarm'] } },
        { id: 'v2', when: { kind: 'status', in: ['warning'] } },
      ],
    },
  ],
  edgeStyles: [{ id: 'wire', name: '我的线' }],
})

/**
 * 挂一份样式栏。
 * @param focus 正在编辑哪一份样式
 * @param selectedPrim 图元树上选中的那一枚
 */
function mountPane(focus: Twin2dStyleFocus = NODE_FOCUS, selectedPrim = '') {
  return mount(StylePane, { props: { config: CONFIG, focus, selectedPrim } })
}

type Wrapper = ReturnType<typeof mountPane>

/**
 * 最后一次合并写入。
 * @param wrapper 挂好的样式栏
 */
function lastMerge(wrapper: Wrapper): [Twin2dConfig, string] {
  const last = wrapper.emitted('merge')?.at(-1)
  if (last === undefined) throw new Error('没有合并写入')
  return last as [Twin2dConfig, string]
}

/**
 * 最后一次一次性写入。
 * @param wrapper 挂好的样式栏
 */
function lastChange(wrapper: Wrapper): Twin2dConfig {
  const last = wrapper.emitted('change')?.at(-1)?.[0]
  if (last === undefined) throw new Error('没有一次性写入')
  return last as Twin2dConfig
}

describe('两条轴各自分派', () => {
  it('节点样式那条轴画节点样式面', () => {
    const wrapper = mountPane()

    expect(wrapper.find('[data-test="style-inspector"]').exists()).toBe(true)
    expect(wrapper.attributes('data-kind')).toBe('styles')
  })

  it('连线样式那条轴画连线样式面', () => {
    const wrapper = mountPane(EDGE_FOCUS)

    expect(wrapper.find('[data-test="edge-style-inspector"]').exists()).toBe(
      true,
    )
  })

  // ⚠ 解析不出样式时画一个空壳，改哪一项都写不回去且不报错
  it('样式已经不在了就落到空态', () => {
    const wrapper = mountPane({ kind: 'styles', id: '没有这个' })

    expect(wrapper.find('[data-test="style-pane-empty"]').exists()).toBe(true)
  })
})

describe('图元那个插槽', () => {
  it('一枚都没选时不画图元字段面', () => {
    const wrapper = mountPane()

    expect(wrapper.findComponent(PrimFields).exists()).toBe(false)
  })

  it('选中一枚就把它摆出来，连挂在盒里的也找得到', () => {
    const wrapper = mountPane(NODE_FOCUS, 't1')

    expect(wrapper.findComponent(PrimFields).props('modelValue')).toMatchObject(
      {
        id: 't1',
        kind: 'txt',
      },
    )
  })

  it('选中的那一枚已经不在了就不画', () => {
    const wrapper = mountPane(NODE_FOCUS, '没有这一枚')

    expect(wrapper.findComponent(PrimFields).exists()).toBe(false)
  })

  it('改一枚图元走合并撤销，合并键带着样式与图元的身份', async () => {
    const wrapper = mountPane(NODE_FOCUS, 't1')
    const before = wrapper.findComponent(PrimFields).props('modelValue')
    const next = { ...(before as Twin2dPrim), hidden: true }

    wrapper.findComponent(PrimFields).vm.$emit('update:modelValue', next)
    await wrapper.vm.$nextTick()

    const [config, key] = lastMerge(wrapper)
    expect(key).toBe('style:st:prim:t1')
    expect(config).not.toBe(CONFIG)
  })

  it('图元面失焦就断段', async () => {
    const wrapper = mountPane(NODE_FOCUS, 't1')

    wrapper.findComponent(PrimFields).vm.$emit('blur')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('endMerge')).toHaveLength(1)
  })

  // ⚠ 画布还接不住取点请求，给了 canPick 就是一枚按下去毫无反应的键
  it('不给取点那一枚键', () => {
    const wrapper = mountPane(NODE_FOCUS, 't1')

    expect(wrapper.findComponent(PrimFields).props('canPick')).not.toBe(true)
  })
})

describe('变体那个插槽', () => {
  it('每一条变体一副面，座次跟着文档序', () => {
    const wrapper = mountPane()

    const rows = wrapper.findAllComponents(VariantFields)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.props('order')).toBe(0)
    expect(rows[1]?.props('order')).toBe(1)
    expect(rows[0]?.props('total')).toBe(2)
  })

  it('改一条变体走合并撤销', async () => {
    const wrapper = mountPane()
    const row = wrapper.findAllComponents(VariantFields)[0]
    const before = row?.props('modelValue') as Twin2dVariant
    const next: Twin2dVariant = { ...before, rootPatch: { lift: 4 } }

    row?.vm.$emit('update:modelValue', next)
    await wrapper.vm.$nextTick()

    expect(lastMerge(wrapper)[1]).toBe('style:st:variant:v1')
  })

  // ⚠ 变体按文档序求值、后者覆盖前者，调序就是在改渲染结果
  it('调序落一步撤销，次序真的换了', async () => {
    const wrapper = mountPane()

    wrapper.findAllComponents(VariantFields)[0]?.vm.$emit('move', 'forward')
    await wrapper.vm.$nextTick()

    expect(
      lastChange(wrapper).styles[0]?.variants.map((item) => item.id),
    ).toEqual(['v2', 'v1'])
  })

  it('加一条变体追加在末尾', async () => {
    const wrapper = mountPane()

    await wrapper.find('[data-test="style-pane-add-variant"]').trigger('click')

    expect(lastChange(wrapper).styles[0]?.variants).toHaveLength(3)
  })

  it('删一条变体', async () => {
    const wrapper = mountPane()

    await wrapper.find('[data-test="style-pane-drop-v1"]').trigger('click')

    expect(
      lastChange(wrapper).styles[0]?.variants.map((item) => item.id),
    ).toEqual(['v2'])
  })
})

describe('往上转交', () => {
  it('样式面自己那些格子的一次性改动原样上抛', async () => {
    const wrapper = mountPane()

    wrapper.getComponent(StyleInspector).vm.$emit('change', CONFIG)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('change')).toHaveLength(1)
  })

  it('图元树选中原样上抛', async () => {
    const wrapper = mountPane()

    wrapper.getComponent(StyleInspector).vm.$emit('pickPrim', 'b1')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('pickPrim')?.[0]).toEqual(['b1'])
  })
})

describe('顶上那张预览', () => {
  it('节点样式那条轴上摆一张，画的就是当下这一份', () => {
    const wrapper = mountPane()

    expect(wrapper.getComponent(Twin2dStylePreview).props('nodeStyle')).toEqual(
      CONFIG.styles[0],
    )
  })

  it('连线样式那条轴上不摆——预览画的是一个节点', () => {
    const wrapper = mountPane(EDGE_FOCUS)

    expect(wrapper.findComponent(Twin2dStylePreview).exists()).toBe(false)
  })

  it('样式编辑面那边关掉它，两张一起摆会把配置挤出屏外', () => {
    const wrapper = mount(StylePane, {
      props: {
        config: CONFIG,
        focus: NODE_FOCUS,
        selectedPrim: '',
        showPreview: false,
      },
    })

    expect(wrapper.findComponent(Twin2dStylePreview).exists()).toBe(false)
    expect(wrapper.find('[data-test="style-inspector"]').exists()).toBe(true)
  })
})
