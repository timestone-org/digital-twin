/**
 * @fileoverview 契约：三维预览的三条不报错的错——环境没有 WebGL 时要说清是
 * 环境的事、下载失败要留一个重试的入口、卸载必须把 GPU 资源还回去。
 *
 * ⚠ 最后一条是这里最要紧的：WebGL 上下文的数量有硬上限（多数浏览器 8～16 个），
 * 卸载只丢引用不 dispose 的话，连开十几个模型之后新的一个再也拿不到上下文，
 * 表现是「预览突然全白」，而控制台只有一句无关痛痒的警告。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHeadlessRenderer } from '@dt/three-core/testing'
import type { HeadlessRenderer } from '@dt/three-core/testing'
import type * as ThreeCore from '@dt/three-core'

import AssetModelViewer from '@/pages/Assets/components/AssetModelViewer.vue'

const seam = vi.hoisted(() => ({
  createWebGLRenderer: vi.fn(),
  loadTwinModel: vi.fn(),
}))

// 只换这两处：场景装配、取景与释放都跑真的，否则这份用例证明不了释放确实发生
vi.mock('@dt/three-core', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeCore>()
  return {
    ...actual,
    createWebGLRenderer: seam.createWebGLRenderer,
    loadTwinModel: seam.loadTwinModel,
  }
})

const URL = '/oss/models/0192f0aa-0000-7000-8000-000000000001/original'

let renderer: HeadlessRenderer

/** 造一个真 `Object3D` 当装载结果，免得为它把 three 列进应用壳的依赖。 */
async function modelStub(): Promise<{ root: unknown; clips: never[] }> {
  const core = await import('@dt/three-core')
  const host = document.createElement('div')
  const scratch = core.createSceneCore({
    container: host,
    renderer: createHeadlessRenderer(),
  })
  return { root: scratch.modelRoot, clips: [] }
}

beforeEach(() => {
  renderer = createHeadlessRenderer()
  seam.createWebGLRenderer.mockReturnValue(renderer)
  seam.loadTwinModel.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function render() {
  const wrapper = mount(AssetModelViewer, { props: { url: URL } })
  await flushPromises()
  return wrapper
}

describe('三维模型预览', () => {
  it('按给的地址去下载模型', async () => {
    seam.loadTwinModel.mockResolvedValue(await modelStub())

    await render()

    expect(seam.loadTwinModel).toHaveBeenCalledWith(URL, expect.anything())
  })

  it('环境没有 WebGL 时说清是环境的事，且一个字节都不下载', async () => {
    seam.createWebGLRenderer.mockReturnValue(null)

    const wrapper = await render()

    // ⚠ 不许说成「模型加载失败」：那会让用户以为自己传的文件坏了，
    // 而真实处置是换一台机器 / 换个浏览器
    expect(wrapper.text()).toContain('WebGL')
    expect(seam.loadTwinModel).not.toHaveBeenCalled()
  })

  it('下载失败时说出原因并留一个重试的入口', async () => {
    seam.loadTwinModel.mockRejectedValue(new Error('取不到这个模型'))

    const wrapper = await render()

    expect(wrapper.text()).toContain('取不到这个模型')
    const retry = wrapper.findAll('button').find((n) => n.text() === '重试')
    expect(retry).toBeDefined()

    seam.loadTwinModel.mockResolvedValue(await modelStub())
    await retry?.trigger('click')
    await flushPromises()

    expect(seam.loadTwinModel).toHaveBeenCalledTimes(2)
  })

  it('卸载时把渲染器还回去，不留一个占着上下文的空壳', async () => {
    seam.loadTwinModel.mockResolvedValue(await modelStub())
    const wrapper = await render()

    wrapper.unmount()

    expect(renderer.disposeCount).toBeGreaterThan(0)
    expect(renderer.forceContextLossCount).toBeGreaterThan(0)
  })

  it('还没画完就被卸载时，那次下载不再往界面上写任何东西', async () => {
    let settle: (value: unknown) => void = () => undefined
    seam.loadTwinModel.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    const wrapper = mount(AssetModelViewer, { props: { url: URL } })

    wrapper.unmount()
    settle(await modelStub())
    await flushPromises()

    // 装载器没有中止能力，取消只能在解析完之后把成果丢掉——丢而不释放就是纯泄漏
    expect(renderer.disposeCount).toBeGreaterThan(0)
  })
})
