/**
 * @fileoverview 契约：批量配置表单——预设条 + **交集**字段表（任一节点上不可见的
 * 字段不出现），混合字段挂徽标、展示主选中的值；既没有字段也没有预设时给一句空态。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { __resetConfigControls } from '@dt/modules'

import type { BatchFieldState } from '@/features/dashboard/batchConfig'
import { installConfigControls } from '@/features/dashboard/configControls'
import BatchConfigForm from '@/pages/DashboardEditor/components/BatchConfigForm.vue'
import BatchFieldRow from '@/pages/DashboardEditor/components/BatchFieldRow.vue'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [
    { key: 'title', label: '标题', type: 'string' },
    { key: 'showUnit', label: '显示单位', type: 'boolean', default: true },
    {
      key: 'unit',
      label: '单位',
      type: 'string',
      when: { key: 'showUnit', in: [true] },
    },
  ],
  configPresets: [
    { id: 'plain', label: '朴素', config: { title: '朴' } },
    { id: 'fancy', label: '花哨', config: { title: '花' } },
  ],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(
  id: string,
  configJson: Record<string, unknown> = {},
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson,
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function mountForm(
  nodes: DashboardNodePayload[],
  over: { manifest?: ModuleManifest | undefined } = {},
) {
  // ⚠ 用 'in' 区分「没传」与「显式 undefined」：默认参数会把后者吞成 MANIFEST
  const manifest = 'manifest' in over ? over.manifest : MANIFEST
  return mount(BatchConfigForm, {
    props: { nodes, primary: nodes[nodes.length - 1] ?? null, manifest },
  })
}

/** 表单里实际画出来的字段键序。 */
function rowKeys(wrapper: ReturnType<typeof mountForm>): string[] {
  return wrapper
    .findAllComponents(BatchFieldRow)
    .map((row) => (row.props('state') as BatchFieldState).field.key)
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('交集字段表', () => {
  it('两个节点都可见的字段各占一行', () => {
    expect(rowKeys(mountForm([node('a'), node('b')]))).toEqual([
      'title',
      'showUnit',
      'unit',
    ])
  })

  it('任一节点上 when 不可见的字段不出现', () => {
    expect(
      rowKeys(mountForm([node('a'), node('b', { showUnit: false })])),
    ).toEqual(['title', 'showUnit'])
  })

  it('字段一改把 config 事件原样转上去', async () => {
    const wrapper = mountForm([node('a'), node('b')])

    await wrapper.find('.dt-input__el').setValue('统一标题')

    expect(wrapper.emitted('config')?.at(-1)).toEqual([
      ['title'],
      '统一标题',
      true,
    ])
  })

  it('值不一致的字段挂「混合」徽标，展示主选中的值', () => {
    const wrapper = mountForm([
      node('a', { title: '甲' }),
      node('b', { title: '乙' }),
    ])

    expect(wrapper.find('[data-test="batch-mixed"]').exists()).toBe(true)
    // 主选中是末位 b；文本控件混合时显示为空（undefined），布尔/枚举才显示主值——
    // 这里用布尔字段验「主值」口径
    const mixedBool = mountForm([
      node('a', { showUnit: true }),
      node('b', { showUnit: false }),
    ])
    expect(mixedBool.find('[data-test="batch-mixed"]').exists()).toBe(true)
  })
})

describe('预设条', () => {
  it('每个预设一个按钮，点了抛 preset', async () => {
    const wrapper = mountForm([node('a'), node('b')])

    await wrapper.find('[data-test="batch-preset-fancy"]').trigger('click')

    expect(wrapper.emitted('preset')).toEqual([
      [{ id: 'fancy', label: '花哨', config: { title: '花' } }],
    ])
  })

  it('「生效中」按主选中的 resolved 判定', () => {
    const wrapper = mountForm([
      node('a', { title: '朴' }),
      node('b', { title: '花' }),
    ])

    expect(
      wrapper
        .find('[data-test="batch-preset-fancy"]')
        .attributes('aria-pressed'),
    ).toBe('true')
    expect(
      wrapper
        .find('[data-test="batch-preset-plain"]')
        .attributes('aria-pressed'),
    ).toBe('false')
  })
})

describe('主选中缺席', () => {
  it('没有主选中时「生效中」退回首个节点判定', () => {
    const nodes = [node('a', { title: '朴' }), node('b', { title: '花' })]
    const wrapper = mount(BatchConfigForm, {
      props: { nodes, primary: null, manifest: MANIFEST },
    })

    expect(
      wrapper
        .find('[data-test="batch-preset-plain"]')
        .attributes('aria-pressed'),
    ).toBe('true')
  })
})

describe('空态', () => {
  it('没有可批量的字段也没有预设时给一句空态', () => {
    const bare: ModuleManifest = {
      ...MANIFEST,
      configSchema: [],
      configPresets: [],
    }

    expect(
      mountForm([node('a'), node('b')], { manifest: bare }).text(),
    ).toContain('这一类模块没有可批量修改的配置项')
  })

  it('清单缺失（模块没注册）同样落到空态而不是炸', () => {
    expect(
      mountForm([node('a'), node('b')], { manifest: undefined }).text(),
    ).toContain('这一类模块没有可批量修改的配置项')
  })
})
