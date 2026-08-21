/**
 * @fileoverview 契约：多选批量配置的纯判定——同类型判定、按类型统计、
 * 可见字段取**交集**（任一节点上 when 不可见即剔除、子编辑器字段剔除）、
 * 混合态按 resolved 值深比较且展示值取主选中。
 */
import { describe, expect, it } from 'vitest'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import {
  batchConfigGroups,
  batchFieldStates,
  intersectFormGroups,
  isUniformType,
  moduleTypeGroups,
} from '@/features/dashboard/batchConfig'

const MANIFEST: ModuleManifest = {
  type: 'demo-card',
  displayName: '演示卡片',
  category: '演示',
  defaultSize: { width: 320, height: 180 },
  configSchema: [
    { key: 'title', label: '标题', type: 'string' },
    { key: 'showUnit', label: '显示单位', type: 'boolean', default: true },
    {
      key: 'unit',
      label: '单位',
      type: 'string',
      when: { key: 'showUnit', in: [true] },
    },
    { key: 'accent', label: '强调色', type: 'color', group: '外观' },
    { key: 'scene', label: '场景', type: 'json', group: '外观' },
  ],
  subEditor: { configKey: 'scene', routeName: 'twin-editor', label: '编辑' },
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

// 剥掉 subEditor 再改型：exactOptionalPropertyTypes 下不许显式赋 undefined
function withoutSubEditor(manifest: ModuleManifest): ModuleManifest {
  const copy = { ...manifest }
  delete copy.subEditor
  return copy
}
const OTHER: ModuleManifest = {
  ...withoutSubEditor(MANIFEST),
  type: 'demo-chart',
  displayName: '演示图表',
}

function getManifest(moduleType: string): ModuleManifest | undefined {
  if (moduleType === MANIFEST.type) return MANIFEST
  if (moduleType === OTHER.type) return OTHER
  return undefined
}

function node(
  id: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo-card',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

describe('同类型判定', () => {
  it('空集不算同类型', () => {
    expect(isUniformType([])).toBe(false)
  })

  it('单个与多个同类都算，混着别的类型不算', () => {
    expect(isUniformType([node('a')])).toBe(true)
    expect(isUniformType([node('a'), node('b')])).toBe(true)
    expect(
      isUniformType([node('a'), node('b', { moduleType: 'demo-chart' })]),
    ).toBe(false)
  })
})

describe('按类型统计', () => {
  it('序按首次出现，同类的 id 归到一组', () => {
    const groups = moduleTypeGroups(
      [node('a'), node('b', { moduleType: 'demo-chart' }), node('c')],
      getManifest,
    )

    expect(groups).toEqual([
      {
        moduleType: 'demo-card',
        displayName: '演示卡片',
        count: 2,
        ids: ['a', 'c'],
      },
      {
        moduleType: 'demo-chart',
        displayName: '演示图表',
        count: 1,
        ids: ['b'],
      },
    ])
  })

  it('清单缺失时显示名退回类型 id 原文', () => {
    const groups = moduleTypeGroups(
      [node('a', { moduleType: 'gone-type' })],
      getManifest,
    )

    expect(groups[0]?.displayName).toBe('gone-type')
  })
})

describe('可见字段交集', () => {
  it('任一节点上 when 不可见的字段不进批量表单', () => {
    const groups = intersectFormGroups(
      [node('a'), node('b', { configJson: { showUnit: false } })],
      MANIFEST,
    )

    const keys = groups.flatMap((group) => group.fields.map((f) => f.key))
    expect(keys).toContain('title')
    expect(keys).not.toContain('unit')
  })

  it('when 判定读铺过缺省的配置：没配过的开关按 default 算可见', () => {
    // 两个节点都没写 showUnit，default: true 让 unit 在两边都可见
    const groups = intersectFormGroups([node('a'), node('b')], MANIFEST)

    const keys = groups.flatMap((group) => group.fields.map((f) => f.key))
    expect(keys).toContain('unit')
  })

  it('声明了子编辑器的字段是跳转入口，不进批量表单', () => {
    const keys = intersectFormGroups([node('a'), node('b')], MANIFEST).flatMap(
      (group) => group.fields.map((f) => f.key),
    )

    expect(keys).not.toContain('scene')
  })

  it('分组标题沿用属性面板口径，剔空的组整组不出', () => {
    // 外观组只有 accent（scene 被子编辑器剔除）；把 accent 也剔掉组就没了
    const bare: ModuleManifest = {
      ...MANIFEST,
      configSchema: [
        { key: 'title', label: '标题', type: 'string' },
        { key: 'scene', label: '场景', type: 'json', group: '外观' },
      ],
    }

    const groups = intersectFormGroups([node('a')], bare)

    expect(groups.map((group) => group.title)).toEqual(['基础'])
  })

  it('空选集或空 schema 给空表单', () => {
    expect(intersectFormGroups([], MANIFEST)).toEqual([])
    expect(
      intersectFormGroups([node('a')], { ...MANIFEST, configSchema: [] }),
    ).toEqual([])
    expect(intersectFormGroups([node('a')], undefined)).toEqual([])
  })
})

describe('混合态', () => {
  const FIELDS = MANIFEST.configSchema.filter((f) => f.key === 'title')

  it('各节点 resolved 值不全等即混合，展示值取主选中', () => {
    const primary = node('b', { configJson: { title: '乙' } })
    const states = batchFieldStates(
      [node('a', { configJson: { title: '甲' } }), primary],
      primary,
      MANIFEST,
      FIELDS,
    )

    expect(states[0]?.isMixed).toBe(true)
    expect(states[0]?.value).toBe('乙')
  })

  it('全体同值不算混合', () => {
    const primary = node('b', { configJson: { title: '同' } })
    const states = batchFieldStates(
      [node('a', { configJson: { title: '同' } }), primary],
      primary,
      MANIFEST,
      FIELDS,
    )

    expect(states[0]?.isMixed).toBe(false)
  })

  it('一边没配、另一边显式配成缺省值：resolved 相等，不算混合', () => {
    const showUnit = MANIFEST.configSchema.filter((f) => f.key === 'showUnit')
    const primary = node('b', { configJson: { showUnit: true } })
    const states = batchFieldStates(
      [node('a'), primary],
      primary,
      MANIFEST,
      showUnit,
    )

    expect(states[0]?.isMixed).toBe(false)
    expect(states[0]?.value).toBe(true)
  })

  it('对象值深比较（同键序）：内容相同不算混合，内容不同算', () => {
    const same = { pad: 4, gap: 2 }
    const primary = node('b', { configJson: { title: { pad: 4, gap: 2 } } })
    const mixedPrimary = node('b', { configJson: { title: { pad: 9 } } })

    expect(
      batchFieldStates(
        [node('a', { configJson: { title: same } }), primary],
        primary,
        MANIFEST,
        FIELDS,
      )[0]?.isMixed,
    ).toBe(false)
    expect(
      batchFieldStates(
        [node('a', { configJson: { title: same } }), mixedPrimary],
        mixedPrimary,
        MANIFEST,
        FIELDS,
      )[0]?.isMixed,
    ).toBe(true)
  })

  it('没给主选中时展示值退回首个节点', () => {
    const states = batchFieldStates(
      [node('a', { configJson: { title: '首' } })],
      null,
      MANIFEST,
      FIELDS,
    )

    expect(states[0]?.value).toBe('首')
  })
})

describe('批量表单模型', () => {
  it('交集 + 混合态一次合成，分组结构与字段状态齐全', () => {
    const primary = node('b', { configJson: { accent: '#111' } })
    const groups = batchConfigGroups(
      [node('a', { configJson: { accent: '#000' } }), primary],
      primary,
      MANIFEST,
    )

    expect(groups.map((group) => group.title)).toEqual(['基础', '外观'])
    const accent = groups[1]?.fields.find(
      (state) => state.field.key === 'accent',
    )
    expect(accent?.isMixed).toBe(true)
    expect(accent?.value).toBe('#111')
  })
})
