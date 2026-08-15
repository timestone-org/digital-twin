/**
 * @fileoverview 守运行态漫游的四条契约：`autoplay` 才自动开播、用户一碰轨道控制器
 * 立刻停、闲置到点自己接上、卸载时计时器与监听都摘干净。
 *
 * ⚠ 「一碰就停」没有它的话，用户拖着看细节、镜头却自己往前飞，表现是「模型甩不住」。
 * ⚠ 计时器漏掉一次就是持续累积的泄漏：大屏一开就是几天。
 */
import {
  MAX_ROAM_STEP_MS,
  normalizeTwinConfig,
  type TwinConfig,
} from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'

import { MAX_FRAME_S } from '../src/frameClock'
import { createSceneCore, type SceneCore } from '../src/sceneCore'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'
import { useRoamTour, type RoamTourController } from '../src/useRoamTour'

const IDLE_MS = 5000

function twinConfig(roamTour: Record<string, unknown>): TwinConfig {
  return normalizeTwinConfig({
    cameras: [
      { id: 'c1', position: [10, 0, 0], target: [0, 0, 0], fov: 40 },
      { id: 'c2', position: [0, 0, 10], target: [0, 0, 0], fov: 40 },
    ],
    roamTour: { items: ['c1', 'c2'], segmentMs: 1000, ...roamTour },
  })
}

let core: SceneCore
let container: HTMLDivElement
let controller: RoamTourController | null = null

const Host = defineComponent({
  props: {
    config: { type: Object as PropType<TwinConfig>, required: true },
  },
  setup(props) {
    controller = useRoamTour({
      core: () => core,
      config: () => props.config,
    })
    return () => h('div')
  },
})

function mountHost(config: TwinConfig) {
  return mount(Host, { props: { config } })
}

/** 取当前控制器；没挂起来就直说，别让断言在 null 上静默通过。 */
function roam(): RoamTourController {
  if (controller === null) throw new Error('组合式函数还没挂起来')
  return controller
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  core = createSceneCore({ container, renderer: createHeadlessRenderer() })
  controller = null
})

afterEach(() => {
  container.remove()
  vi.useRealTimers()
})

describe('时间线与帧钟的上限对齐', () => {
  // ⚠ 两处各写一份必漂：帧钟按秒夹、时间线按毫秒夹，漂了就等于漫游少了这道防线
  it('单步上限就是帧钟那一帧的上限', () => {
    expect(MAX_ROAM_STEP_MS).toBe(MAX_FRAME_S * 1000)
  })
})

describe('开播时机', () => {
  it('autoplay 开着时装上就开播', () => {
    const wrapper = mountHost(twinConfig({ enabled: true, autoplay: true }))
    roam().attach()
    expect(roam().playing.value).toBe(true)
    wrapper.unmount()
  })

  it('没开 autoplay 就不动镜头', () => {
    const wrapper = mountHost(twinConfig({ enabled: true, autoplay: false }))
    roam().attach()
    expect(roam().playing.value).toBe(false)
    wrapper.unmount()
  })

  it('整段没启用时 autoplay 也不开播', () => {
    const wrapper = mountHost(twinConfig({ enabled: false, autoplay: true }))
    roam().attach()
    expect(roam().playing.value).toBe(false)
    wrapper.unmount()
  })

  it('推进会把插值出来的位姿落到相机上', () => {
    const wrapper = mountHost(twinConfig({ enabled: true, autoplay: true }))
    roam().attach()
    roam().advance(MAX_ROAM_STEP_MS)
    expect(core.camera.position.x).toBeLessThan(10)
    wrapper.unmount()
  })
})

describe('用户一碰就停', () => {
  it('轨道控制器一开始交互就停播', () => {
    const wrapper = mountHost(twinConfig({ enabled: true, autoplay: true }))
    roam().attach()
    core.controls.dispatchEvent({ type: 'start' })
    expect(roam().playing.value).toBe(false)
    wrapper.unmount()
  })

  it('停播之后推进不再动镜头', () => {
    const wrapper = mountHost(twinConfig({ enabled: true, autoplay: true }))
    roam().attach()
    core.controls.dispatchEvent({ type: 'start' })
    core.camera.position.set(1, 2, 3)
    roam().advance(MAX_ROAM_STEP_MS)
    expect(core.camera.position.toArray()).toEqual([1, 2, 3])
    wrapper.unmount()
  })
})

describe('闲置自动开播', () => {
  it('闲置到点自己接上', () => {
    vi.useFakeTimers()
    const wrapper = mountHost(
      twinConfig({
        enabled: true,
        autoplay: false,
        idleAutoplay: true,
        idleAutoplayDelayMs: IDLE_MS,
      }),
    )
    roam().attach()
    expect(roam().playing.value).toBe(false)
    vi.advanceTimersByTime(IDLE_MS)
    expect(roam().playing.value).toBe(true)
    wrapper.unmount()
  })

  it('用户一动就重新计时，没到点不会又开播', () => {
    vi.useFakeTimers()
    const wrapper = mountHost(
      twinConfig({
        enabled: true,
        autoplay: true,
        idleAutoplay: true,
        idleAutoplayDelayMs: IDLE_MS,
      }),
    )
    roam().attach()
    core.controls.dispatchEvent({ type: 'start' })
    vi.advanceTimersByTime(IDLE_MS - 1)
    expect(roam().playing.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(roam().playing.value).toBe(true)
    wrapper.unmount()
  })

  // ⚠ 没开这一档就一个计时器都不该留
  it('没开闲置自动播时不留计时器', () => {
    vi.useFakeTimers()
    const wrapper = mountHost(
      twinConfig({ enabled: true, idleAutoplay: false }),
    )
    roam().attach()
    expect(vi.getTimerCount()).toBe(0)
    wrapper.unmount()
  })
})

describe('控件与卸载', () => {
  it('启用且有轨迹时才显示控件', () => {
    const wrapper = mountHost(twinConfig({ enabled: true, showControls: true }))
    expect(roam().showControls.value).toBe(true)
    wrapper.unmount()
  })

  it('站点不够两个时不显示控件', () => {
    const wrapper = mountHost(
      twinConfig({ enabled: true, showControls: true, items: ['c1'] }),
    )
    expect(roam().showControls.value).toBe(false)
    wrapper.unmount()
  })

  it('toggle 在播与停之间来回', () => {
    const wrapper = mountHost(twinConfig({ enabled: true }))
    roam().attach()
    roam().toggle()
    expect(roam().playing.value).toBe(true)
    roam().toggle()
    expect(roam().playing.value).toBe(false)
    wrapper.unmount()
  })

  it('下一段与上一段直接把镜头搬到那一站', () => {
    const wrapper = mountHost(twinConfig({ enabled: true }))
    roam().attach()
    roam().next()
    expect(core.camera.position.toArray()).toEqual([0, 0, 10])
    roam().prev()
    expect(core.camera.position.toArray()).toEqual([10, 0, 0])
    wrapper.unmount()
  })

  it('卸载后计时器与监听都不再留着', () => {
    vi.useFakeTimers()
    const wrapper = mountHost(
      twinConfig({
        enabled: true,
        idleAutoplay: true,
        idleAutoplayDelayMs: IDLE_MS,
      }),
    )
    roam().attach()
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
    core.controls.dispatchEvent({ type: 'start' })
    expect(roam().playing.value).toBe(false)
  })
})
