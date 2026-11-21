/**
 * @fileoverview 画布节点的设计态演示配置：只补内容键，观感键一律按节点自己的取值。
 * ⚠ 演示值盖到观感键上时，画布与运行态长成两个样子（图片块在画布上被裁、运行态完整）。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { ModuleRenderer } from '@dt/runtime'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import CanvasNode from '@/pages/DashboardEditor/components/CanvasNode.vue'

enableAutoUnmount(afterEach)

const IMAGE: ModuleManifest = {
  type: 'demo-image',
  displayName: '演示图片',
  category: '演示',
  chrome: 'bare',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  contentKeys: ['src'],
  bindings: [],
  preview: { config: { src: 'linear-gradient(red, blue)', fit: 'cover' } },
  component: () => Promise.resolve({ default: { template: '<i />' } }),
}

const BARE: ModuleManifest = {
  type: 'demo-bare',
  displayName: '演示',
  category: '演示',
  chrome: 'bare',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [],
  preview: { config: { title: '演示标题' } },
  component: () => Promise.resolve({ default: { template: '<i />' } }),
}

function node(
  moduleType: string,
  configJson: Record<string, unknown>,
): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    zIndex: 0,
    isVisible: true,
    configJson,
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function mountNode(target: DashboardNodePayload) {
  return mount(CanvasNode, {
    props: {
      frame: {
        id: 'n1',
        left: 0,
        top: 0,
        width: 100,
        height: 100,
        depth: 0,
        isVisible: true,
        zIndex: 0,
      },
      node: target,
      getManifest: (type: string) => (type === IMAGE.type ? IMAGE : BARE),
      cardChrome: {},
      isSelected: false,
      hasHandles: false,
      pinnedEdge: null,
      zIndex: 0,
    },
    global: { stubs: { ModuleRenderer: true } },
  })
}

function configOf(target: DashboardNodePayload): unknown {
  return mountNode(target).getComponent(ModuleRenderer).props('config')
}

describe('设计态演示配置', () => {
  it('⚠ 演示值不盖观感键：选了图的节点按自己的填充方式画', () => {
    expect(configOf(node(IMAGE.type, { src: 'asset:a1' }))).toEqual({
      src: 'asset:a1',
    })
  })

  it('空节点照样补上演示内容', () => {
    expect(configOf(node(IMAGE.type, {}))).toEqual({
      src: 'linear-gradient(red, blue)',
    })
  })

  it('没声明内容键的模块，演示配置照旧整份补', () => {
    expect(configOf(node(BARE.type, {}))).toEqual({ title: '演示标题' })
  })

  it('平移保持模块配置，内容编辑仍更新模块', async () => {
    const previous = node(BARE.type, { title: '原有标题' })
    const wrapper = mountNode(previous)
    const renderer = wrapper.getComponent(ModuleRenderer)
    const config = renderer.props('config')
    const moved = { ...previous, x: 40, y: 20 }

    await wrapper.setProps({ node: moved })
    expect(renderer.props('config')).toBe(config)

    await wrapper.setProps({
      node: { ...moved, configJson: { title: '新标题' } },
    })
    expect(renderer.props('config')).toEqual({ title: '新标题' })
  })
})
