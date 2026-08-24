/**
 * @fileoverview 契约：视口右下角的画中画按大屏格子的宽高比画当前草稿，
 * 并且走的是运行态那一条渲染链。
 *
 * ⚠ 画中画的框必须与大屏格子同比例、内容按设计像素缩放：不缩放的话 16px 的
 * 标题在小框里占的比例远大于大屏上，字号这类配置全看不准。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { normalizeTwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TwinRuntimePreview from '@/pages/TwinEditor/components/TwinRuntimePreview.vue'

const seam = vi.hoisted(() => ({ manifest: null as ModuleManifest | null }))

vi.mock('@dt/modules', () => ({ getModule: () => seam.manifest ?? undefined }))

const DRAFT = normalizeTwinConfig({ model: { asset: 'asset:new' } })

const MANIFEST: ModuleManifest = {
  type: 'twin-view',
  displayName: '数字孪生',
  category: '孪生',
  defaultSize: { width: 1280, height: 720 },
  configSchema: [],
  bindings: [],
  subEditor: {
    configKey: 'twin',
    routeName: 'twin-editor',
    label: '打开孪生编辑器',
  },
  component: () => Promise.resolve({ default: {} }),
}

function node(
  overrides: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'twin-view',
    x: 0,
    y: 0,
    w: 1280,
    h: 720,
    zIndex: 1,
    isVisible: true,
    configJson: { title: '一号厂区', twin: { model: { asset: 'asset:old' } } },
    bindings: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

function mountPreview(props: Record<string, unknown> = {}) {
  return mount(TwinRuntimePreview, {
    props: {
      node: node(),
      config: DRAFT,
      bindings: [],
      readBinding: () => () => ({ state: 'error', message: '没装取数' }),
      ...props,
    },
    global: { stubs: { ModuleRenderer: true } },
  })
}

async function opened(props: Record<string, unknown> = {}) {
  const wrapper = mountPreview(props)
  await wrapper.get('[data-test="open-preview"]').trigger('click')
  return wrapper
}

beforeEach(() => {
  seam.manifest = MANIFEST
})

describe('开关', () => {
  // ⚠ 3D 预览自带一个 WebGL 上下文并把模型再解析一遍，常挂着等于整页把模型
  // 显存吃两份——所以缺省是收着的，只有点开才挂
  it('缺省收着，不挂任何渲染', () => {
    const wrapper = mountPreview()

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
  })

  it('点开才挂上运行态渲染', async () => {
    const wrapper = await opened()

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(true)
  })

  it('关掉就卸下来', async () => {
    const wrapper = await opened()

    await wrapper.get('[data-test="close-preview"]').trigger('click')

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
  })
})

describe('比例', () => {
  it('框按大屏格子的宽高比缩，不是按一个固定比例', async () => {
    const wrapper = await opened()

    const style = wrapper.get('[data-test="preview-box"]').attributes('style')
    expect(style).toContain('width: 320px')
    expect(style).toContain('height: 180px')
  })

  it('竖长的格子照样按它自己的比例', async () => {
    const wrapper = await opened({ node: node({ w: 400, h: 800 }) })

    const style = wrapper.get('[data-test="preview-box"]').attributes('style')
    expect(style).toContain('width: 110px')
    expect(style).toContain('height: 220px')
  })

  it('放大档还是同一个比例，只是更大', async () => {
    const wrapper = await opened()

    await wrapper.get('[data-test="toggle-wide"]').trigger('click')

    const style = wrapper.get('[data-test="preview-box"]').attributes('style')
    expect(style).toContain('width: 760px')
    expect(style).toContain('height: 428px')
  })

  // ⚠ 内容按设计像素铺开再整体缩：直接渲染进小框的话字号全看不准
  it('里层按设计像素铺开，再整体缩到框那么大', async () => {
    const wrapper = await opened()

    const style = wrapper.get('.twin-preview__stage').attributes('style')
    expect(style).toContain('width: 1280px')
    expect(style).toContain('height: 720px')
    expect(style).toContain('scale(0.25)')
  })

  it('尺寸上写着大屏上占多大', async () => {
    const wrapper = await opened()

    expect(wrapper.text()).toContain('1280 × 720')
  })
})

describe('喂给模块的东西', () => {
  it('注回的是内存里的草稿，其余配置原样带上', async () => {
    const wrapper = await opened()

    const renderer = wrapper.getComponent({ name: 'ModuleRenderer' })
    expect(renderer.props('config')).toEqual({ title: '一号厂区', twin: DRAFT })
    expect(renderer.props('moduleType')).toBe('twin-view')
  })
})

describe('预览不了的时候', () => {
  it('模块没注册就直说，不留一块空白', async () => {
    seam.manifest = null
    const wrapper = await opened()

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('预览不了')
  })

  it('大屏上取不到尺寸时也直说', async () => {
    const wrapper = await opened({ node: node({ w: 0 }) })

    expect(wrapper.find('[data-test="preview-box"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('预览不了')
  })
})
