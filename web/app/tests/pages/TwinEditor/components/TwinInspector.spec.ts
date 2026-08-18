/**
 * @fileoverview 契约：右栏检查器的分派——选中什么就画什么，改完整份写回。
 *
 * ⚠ 这一层是纯分派，坏了的样子特别安静：选中箭头却画出锚点检查器，两边字段名
 * 相近，改半天改的是另一个实体。分派靠的是模板里的 `v-else-if` 链与十来处
 * prop 名，而**模板里的 prop 名写错 typecheck 与 lint 双双放行**，只能靠这里兜。
 *
 * ⚠ 另一条：每个 `write*` 都要把整份数组重建、只换掉那一项。写成「只发改动的
 * 那一个」会让 patch 合并时把同数组的其余实体整片抹掉，而界面要等下一次重载
 * 才看得出来。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import type { Component } from 'vue'
import { describe, expect, it } from 'vitest'

import AnchorInspector from '@/pages/TwinEditor/components/inspector/AnchorInspector.vue'
import ArrowInspector from '@/pages/TwinEditor/components/inspector/ArrowInspector.vue'
import CameraInspector from '@/pages/TwinEditor/components/inspector/CameraInspector.vue'
import FlowInspector from '@/pages/TwinEditor/components/inspector/FlowInspector.vue'
import HierNodeInspector from '@/pages/TwinEditor/components/inspector/HierNodeInspector.vue'
import ModelInspector from '@/pages/TwinEditor/components/inspector/ModelInspector.vue'
import PanelInspector from '@/pages/TwinEditor/components/inspector/PanelInspector.vue'
import PartInspector from '@/pages/TwinEditor/components/inspector/PartInspector.vue'
import RoamTourInspector from '@/pages/TwinEditor/components/inspector/RoamTourInspector.vue'
import ViewpointsInspector from '@/pages/TwinEditor/components/inspector/ViewpointsInspector.vue'
import TwinInspector from '@/pages/TwinEditor/components/TwinInspector.vue'
import type { TwinSelection } from '@/pages/TwinEditor/scripts/types'

// 七类实体各两个：只有两个才验得出「换掉一项」有没有把另一项一起带走
const CONFIG: TwinConfig = normalizeTwinConfig({
  parts: [
    { id: 'pt1', name: '泵体' },
    { id: 'pt2', name: '底座' },
  ],
  anchors: [
    { id: 'a1', name: '进口' },
    { id: 'a2', name: '出口' },
  ],
  cameras: [
    { id: 'c1', name: '总览' },
    { id: 'c2', name: '侧视' },
  ],
  panels: [
    { id: 'p1', name: '泵组', fields: [{ key: 'temp', label: '温度' }] },
    { id: 'p2', name: '风机', fields: [] },
  ],
  arrows: [
    { id: 'ar1', name: '进气' },
    { id: 'ar2', name: '排气' },
  ],
  flows: [
    { id: 'f1', name: '冷却水' },
    { id: 'f2', name: '回水' },
  ],
  hierNodes: [
    { id: 'h1', name: '一层' },
    { id: 'h2', name: '二层' },
  ],
})

function mountInspector(selection: TwinSelection) {
  return mount(TwinInspector, {
    props: {
      config: CONFIG,
      selection,
      modelNodes: ['Pump', 'Base'],
      picking: false,
      roamPreviewing: false,
      gizmoMode: 'translate',
    },
  })
}

type Wrapper = ReturnType<typeof mountInspector>

function lastPatch(wrapper: Wrapper): Partial<TwinConfig> {
  const events = wrapper.emitted('patch')
  if (!events?.length) throw new Error('没有向上发 patch')
  return events[events.length - 1]?.[0] as Partial<TwinConfig>
}

/** 表格显式定型，省掉逐行的类型断言。 */
type DispatchCase = readonly [string, TwinSelection, Component]

const DISPATCH: readonly DispatchCase[] = [
  ['model', { kind: 'model' }, ModelInspector],
  ['viewpoints', { kind: 'viewpoints' }, ViewpointsInspector],
  ['roam', { kind: 'roam' }, RoamTourInspector],
  ['parts', { kind: 'parts', id: 'pt1' }, PartInspector],
  ['anchors', { kind: 'anchors', id: 'a1' }, AnchorInspector],
  ['cameras', { kind: 'cameras', id: 'c1' }, CameraInspector],
  ['panels', { kind: 'panels', id: 'p1' }, PanelInspector],
  ['arrows', { kind: 'arrows', id: 'ar1' }, ArrowInspector],
  ['flows', { kind: 'flows', id: 'f1' }, FlowInspector],
  ['hierNodes', { kind: 'hierNodes', id: 'h1' }, HierNodeInspector],
]

describe('选中什么就画什么', () => {
  it.each(DISPATCH)(
    '选中 %s 画出对应的检查器',
    (_name, selection, expected) => {
      expect(mountInspector(selection).findComponent(expected).exists()).toBe(
        true,
      )
    },
  )

  it('⚠ 一次只画一种：分派链漏写 v-else 会同时画出两个检查器', () => {
    const wrapper = mountInspector({ kind: 'anchors', id: 'a1' })

    expect(wrapper.findComponent(AnchorInspector).exists()).toBe(true)
    expect(wrapper.findComponent(PartInspector).exists()).toBe(false)
    expect(wrapper.findComponent(ArrowInspector).exists()).toBe(false)
  })

  // ⚠ 删掉一个实体而选中还指着它，是删除后必然经过的一拍
  it('选中的实体已经不在了就说出来，不画任何检查器', () => {
    const wrapper = mountInspector({ kind: 'anchors', id: 'gone' })

    expect(wrapper.text()).toContain('选中的东西已经不在了')
    expect(wrapper.findComponent(AnchorInspector).exists()).toBe(false)
  })
})

/** 一项实体槽的用例：槽名、选中、子件、同槽里另一项的 id。 */
type ListCase = readonly [string, TwinSelection, Component, string]

const LISTS: readonly ListCase[] = [
  ['anchors', { kind: 'anchors', id: 'a1' }, AnchorInspector, 'a2'],
  ['cameras', { kind: 'cameras', id: 'c1' }, CameraInspector, 'c2'],
  ['panels', { kind: 'panels', id: 'p1' }, PanelInspector, 'p2'],
  ['arrows', { kind: 'arrows', id: 'ar1' }, ArrowInspector, 'ar2'],
  ['flows', { kind: 'flows', id: 'f1' }, FlowInspector, 'f2'],
  ['parts', { kind: 'parts', id: 'pt1' }, PartInspector, 'pt2'],
  ['hierNodes', { kind: 'hierNodes', id: 'h1' }, HierNodeInspector, 'h2'],
]

type SingletonCase = readonly [string, TwinSelection, Component]

const SINGLETONS: readonly SingletonCase[] = [
  ['model', { kind: 'model' }, ModelInspector],
  ['viewpoints', { kind: 'viewpoints' }, ViewpointsInspector],
  ['roamTour', { kind: 'roam' }, RoamTourInspector],
]

/**
 * ⚠ 每个 write 都要整份数组重建、只换那一项。发「只有改动的那一个」的数组，
 * patch 合并时会把同数组的其余实体整片抹掉。
 */
describe('改完整份写回', () => {
  it.each(LISTS)(
    '改 %s 里的一项，另一项还在原地',
    (key, selection, child, siblingId) => {
      const wrapper = mountInspector(selection)
      const list = CONFIG[key as 'anchors'] as readonly { id: string }[]

      wrapper
        .findComponent(child)
        .vm.$emit('update:modelValue', { ...list[0], name: '改过了' })

      const patched = lastPatch(wrapper)[key as 'anchors'] as readonly {
        id: string
        name?: string
      }[]
      expect(patched).toHaveLength(2)
      expect(patched[0]?.name).toBe('改过了')
      expect(patched[1]?.id).toBe(siblingId)
    },
  )

  it.each(SINGLETONS)('单例段 %s 直接整段写回', (key, selection, child) => {
    const wrapper = mountInspector(selection)
    const next = CONFIG[key as 'model']

    wrapper.findComponent(child).vm.$emit('update:modelValue', next)

    expect(lastPatch(wrapper)).toEqual({ [key]: next })
  })
})

describe('往上转发的动作', () => {
  it('部件要拾取模型节点', () => {
    const wrapper = mountInspector({ kind: 'parts', id: 'pt1' })

    wrapper.findComponent(PartInspector).vm.$emit('requestPickNode')

    expect(wrapper.emitted('requestPick')?.[0]).toEqual(['node'])
  })

  it('锚点要拾取的是位置，不是节点', () => {
    const wrapper = mountInspector({ kind: 'anchors', id: 'a1' })

    wrapper.findComponent(AnchorInspector).vm.$emit('requestPickPosition')

    expect(wrapper.emitted('requestPick')?.[0]).toEqual(['position'])
  })

  it('取消拾取原样上抛', () => {
    const wrapper = mountInspector({ kind: 'anchors', id: 'a1' })

    wrapper.findComponent(AnchorInspector).vm.$emit('cancelPick')

    expect(wrapper.emitted('cancelPick')).toHaveLength(1)
  })

  // ⚠ 带上是哪个视点：不带的话「存当前视角」会存到列表里的第一个上
  it('视点存当前视角带上它自己的 id', () => {
    const wrapper = mountInspector({ kind: 'cameras', id: 'c2' })

    wrapper.findComponent(CameraInspector).vm.$emit('captureCurrent')

    expect(wrapper.emitted('captureCamera')?.[0]).toEqual(['c2'])
  })

  it('钻取节点存视角带上事件里的那个 id', () => {
    const wrapper = mountInspector({ kind: 'hierNodes', id: 'h1' })

    wrapper.findComponent(HierNodeInspector).vm.$emit('captureView', 'h1')

    expect(wrapper.emitted('captureHierView')?.[0]).toEqual(['h1'])
  })

  it('漫游的预览与停止各自上抛', () => {
    const wrapper = mountInspector({ kind: 'roam' })
    const roam = wrapper.findComponent(RoamTourInspector)

    roam.vm.$emit('preview')
    roam.vm.$emit('stopPreview')

    expect(wrapper.emitted('previewRoam')).toHaveLength(1)
    expect(wrapper.emitted('stopRoamPreview')).toHaveLength(1)
  })

  it('箭头能改视口手柄的模式', () => {
    const wrapper = mountInspector({ kind: 'arrows', id: 'ar1' })

    wrapper.findComponent(ArrowInspector).vm.$emit('update:gizmoMode', 'rotate')

    expect(wrapper.emitted('update:gizmoMode')?.[0]).toEqual(['rotate'])
  })
})
