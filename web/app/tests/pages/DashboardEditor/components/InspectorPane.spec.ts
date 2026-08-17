/**
 * @fileoverview 契约：绑点面板的行名由**清单自述**，右栏只负责转发。
 * ⚠ 这条接线断了不会报错也不会崩——面板照常渲染，只是十几行绑定全变成
 * 「第 N 行」，配的人只能靠数数认实体。它是这套面板最容易接错对象的地方。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type {
  BindingRowLabel,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'

import InspectorPane from '@/pages/DashboardEditor/components/InspectorPane.vue'

const ARRAY_BINDING = {
  key: 'rows',
  label: '多行',
  dataType: 'number' as const,
  isArray: true,
  arrayFields: [{ key: 'value', label: '数值', dataType: 'number' as const }],
}

/** 会自述行名的清单：第 i 行叫配置里第 i 个实体的名字。 */
const NAMED: ModuleManifest = {
  type: 'named',
  displayName: '会报行名的模块',
  category: '演示',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [ARRAY_BINDING],
  bindingRowLabels: (config) => {
    const names = Array.isArray(config.names) ? config.names : []
    const labels: Record<string, BindingRowLabel> = {}
    names.forEach((name, index) => {
      if (typeof name === 'string') {
        labels[`rows[${index}].value`] = { title: name, id: `unit-${index}` }
      }
    })
    return labels
  },
  bindingRowCounts: (config) => ({
    rows: Array.isArray(config.names) ? config.names.length : 0,
  }),
  component: () => Promise.resolve({ default: {} }),
}

/** 不自述行名的清单：面板该退回「第 N 行」。 */
const PLAIN: ModuleManifest = {
  type: 'plain',
  displayName: '不报行名的模块',
  category: '演示',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [ARRAY_BINDING],
  component: () => Promise.resolve({ default: {} }),
}

function node(moduleType: string): DashboardNodePayload {
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
    configJson: { names: ['一号机组', '二号机组'] },
    createdAt: '',
    updatedAt: '',
    bindings: [
      {
        id: 'b1',
        nodeId: 'n1',
        fieldKey: 'rows[0].value',
        sourceKind: 'static',
        nodeKey: null,
        staticValueJson: 1,
        computeJson: null,
        detailJson: null,
        transformJson: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
  }
}

function mountAt(manifest: ModuleManifest) {
  const selected = node(manifest.type)
  return mount(InspectorPane, {
    props: {
      selected,
      nodes: [selected],
      getManifest: () => manifest,
      rules: [],
    },
  })
}

/** 切到绑点页；页签是一排按钮。 */
async function openBindingTab(
  wrapper: ReturnType<typeof mountAt>,
): Promise<void> {
  const tab = wrapper
    .findAll('button')
    .find((item) => item.text().trim() === '绑定')
  await tab?.trigger('click')
}

describe('行名转发', () => {
  it('清单自述了行名就用它，而不是让人数行号', async () => {
    const wrapper = mountAt(NAMED)

    await openBindingTab(wrapper)

    expect(wrapper.text()).toContain('一号机组')
    wrapper.unmount()
  })

  it('清单没自述时退回「第 N 行」，不是空标题', async () => {
    const wrapper = mountAt(PLAIN)

    await openBindingTab(wrapper)

    expect(wrapper.text()).toContain('第 1 行')
    expect(wrapper.text()).not.toContain('一号机组')
    wrapper.unmount()
  })
})

/**
 * ⚠ 行跟着实体走的模块（孪生）如果这条接线断了，面板会摆出「新增一行」——
 * 加出来的那一行没有对应实体、永远喂不到任何东西，绑完看着是配好了，
 * 画面上一点反应都没有。
 */
describe('行数转发', () => {
  it('清单声明了行数就不摆手工增删键', async () => {
    const wrapper = mountAt(NAMED)

    await openBindingTab(wrapper)

    expect(
      wrapper.findAll('button').some((item) => item.text().includes('新增一行')),
    ).toBe(false)
    wrapper.unmount()
  })

  it('清单没声明时还是手工增删', async () => {
    const wrapper = mountAt(PLAIN)

    await openBindingTab(wrapper)

    expect(
      wrapper.findAll('button').some((item) => item.text().includes('新增一行')),
    ).toBe(true)
    wrapper.unmount()
  })
})
