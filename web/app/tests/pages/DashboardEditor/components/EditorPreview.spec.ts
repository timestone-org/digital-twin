/**
 * @fileoverview 契约：编辑器的全屏预览**按运行态口径跑联动**——控件上抛的事件
 * 真去改显隐、真开弹窗，高亮真跟着「当前这张屏」走；只有跨屏跳转不跳，换成一句
 * 说明。⚠ 不装引擎的话，预览里点页签栏这类控件是彻底静默的：高亮挪一下、屏不换、
 * 一句话都没有，与「模块坏了」分不出来。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import EditorPreview from '@/pages/DashboardEditor/components/EditorPreview.vue'

/** 替页签栏这类控件：两格，点哪一格就带哪一格的值上抛「选项点击」。 */
const PICKER: ModuleManifest = {
  type: 'picker',
  displayName: '挑一格',
  category: '演示',
  chrome: 'bare',
  emitsInteractions: true,
  interactionEvents: ['select'],
  defaultSize: { width: 200, height: 48 },
  configSchema: [],
  bindings: [],
  component: () =>
    Promise.resolve({
      default: {
        props: { config: Object, values: Object, meta: Object },
        emits: ['interaction'],
        template: `<div>
          <button
            v-for="value in ['a', 'b']"
            :key="value"
            :data-test="'pick-' + value"
            @click="$emit('interaction', { event: 'select', value })"
          >{{ value }}</button>
          <i data-test="active">{{ meta?.activeValue ?? '' }}</i>
        </div>`,
      },
    }),
}

const PLAIN: ModuleManifest = {
  ...PICKER,
  type: 'plain',
  emitsInteractions: false,
  component: () =>
    Promise.resolve({ default: { template: '<i data-test="plain" />' } }),
}

function getManifest(moduleType: string): ModuleManifest | undefined {
  if (moduleType === PICKER.type) return PICKER
  return moduleType === PLAIN.type ? PLAIN : undefined
}

function node(
  id: string,
  moduleType: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd-1',
    parentId: null,
    clientKey: null,
    moduleType,
    x: 0,
    y: 0,
    w: 200,
    h: 48,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    bindings: [],
    ...over,
  }
}

const NODES = [node('n-pick', PICKER.type), node('n-panel', PLAIN.type)]

/** 挂上预览；`chromeJson` 就是草稿里那只外观袋，联动规则在它的 interactions 段。 */
async function open(chromeJson: Record<string, unknown>) {
  const wrapper = mount(EditorPreview, {
    props: {
      nodes: NODES,
      design: { width: 1920, height: 1080 },
      getManifest,
      chromeJson,
      dashboardId: 'd-1',
    },
  })
  // 异步 chunk：等那一格真渲染出来，别用定时器碰运气
  await flushPromises()
  await vi.waitFor(() =>
    expect(wrapper.find('[data-test="pick-a"]').exists()).toBe(true),
  )
  return wrapper
}

function hideRule() {
  return {
    id: 'r-hide',
    source: { nodeId: 'n-pick', event: 'select' },
    action: { type: 'hide', targets: ['n-panel'] },
  }
}

function jumpRule() {
  return {
    id: 'r-jump',
    source: { nodeId: 'n-pick', event: 'select' },
    action: {
      type: 'navigateByValue',
      routes: [
        { value: 'a', target: 'd-1' },
        { value: 'b', target: 'd-2' },
      ],
    },
  }
}

describe('预览里的联动', () => {
  it('页内规则当真生效：点一格，被控制的那个节点就没了', async () => {
    const wrapper = await open({ interactions: [hideRule()] })
    expect(wrapper.find('[data-test="plain"]').exists()).toBe(true)

    await wrapper.get('[data-test="pick-a"]').trigger('click')

    expect(wrapper.find('[data-test="plain"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('高亮跟着当前这张屏走：指向本屏的那一格就是选中值', async () => {
    const wrapper = await open({ interactions: [jumpRule()] })

    expect(wrapper.get('[data-test="active"]').text()).toBe('a')
    wrapper.unmount()
  })

  it('跨屏跳转不跳走，但要说一句：静默不动与「模块坏了」分不出来', async () => {
    const wrapper = await open({ interactions: [jumpRule()] })

    await wrapper.get('[data-test="pick-b"]').trigger('click')

    expect(wrapper.get('[data-test="preview-jump-notice"]').text()).toContain(
      '预览里不跳走',
    )
    wrapper.unmount()
  })

  it('点的是指向本屏那一格时不摆提示：运行态在那一档也什么都不做', async () => {
    const wrapper = await open({ interactions: [jumpRule()] })

    await wrapper.get('[data-test="pick-a"]').trigger('click')

    expect(wrapper.find('[data-test="preview-jump-notice"]').exists()).toBe(
      false,
    )
    wrapper.unmount()
  })

  it('没配跳转规则时点了不摆那句提示', async () => {
    const wrapper = await open({ interactions: [hideRule()] })

    await wrapper.get('[data-test="pick-a"]').trigger('click')

    expect(wrapper.find('[data-test="preview-jump-notice"]').exists()).toBe(
      false,
    )
    wrapper.unmount()
  })
})
