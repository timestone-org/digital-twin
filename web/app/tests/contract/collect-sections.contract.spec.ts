/**
 * @fileoverview 采集详情页对外面的契约。
 *
 * ⚠ 存在的理由只有一条：**模板里的 prop 名、插槽名、组件注册名写错时，
 * typecheck 与 lint 双双放行**。详情页用 `<component :is>` 往分区里喂
 * `source`，把某个分区的 prop 改名成别的，编译一路绿，运行时那个分区收到
 * undefined，页面白掉——没有任何一道现成的闸门会响。
 */
import { describe, expect, it } from 'vitest'

import BrowsePanel from '@/pages/Collect/OpcuaSourceDetail/components/BrowsePanel.vue'
import ImportPointsDialog from '@/pages/Collect/OpcuaSourceDetail/components/ImportPointsDialog.vue'
import PointFormDialog from '@/pages/Collect/OpcuaSourceDetail/components/PointFormDialog.vue'
import PointsPanel from '@/pages/Collect/OpcuaSourceDetail/components/PointsPanel.vue'
import PointValueCell from '@/pages/Collect/OpcuaSourceDetail/components/PointValueCell.vue'
import SourceStateTag from '@/pages/Collect/OpcuaSources/components/SourceStateTag.vue'
import WriteValueDialog from '@/pages/Collect/OpcuaSourceDetail/components/WriteValueDialog.vue'
import { router } from '@/router'

/**
 * 读组件对外面上的某个名字表。`<script setup>` 编译出来的 props / emits
 * 可能是数组也可能是对象，统一成名字数组。
 * @param component 组件本身
 * @param field 'props' 或 'emits'
 */
function faceNames(component: unknown, field: 'props' | 'emits'): string[] {
  if (typeof component !== 'object' || component === null) return []
  const face: unknown = Reflect.get(component, field)
  if (Array.isArray(face)) {
    return face.filter((name): name is string => typeof name === 'string')
  }
  if (typeof face === 'object' && face !== null) return Object.keys(face)
  return []
}

function propNames(component: unknown): string[] {
  return faceNames(component, 'props')
}

function emitNames(component: unknown): string[] {
  return faceNames(component, 'emits')
}

const SECTIONS = [
  ['点位', PointsPanel],
  ['地址空间', BrowsePanel],
] as const

describe('详情页两个分区收同一个 prop', () => {
  it.each(SECTIONS)('%s 收 source', (_label, component) => {
    expect(propNames(component)).toEqual(['source'])
  })

  it('⚠ 两个分区的 prop 完全一致——详情页只喂一个 `:source`，多一个就是 undefined', () => {
    const shapes = SECTIONS.map(([, component]) => propNames(component))
    expect(new Set(shapes.map((names) => names.join(',')))).toHaveProperty(
      'size',
      1,
    )
  })
})

describe('分区确实挂在路由上', () => {
  const BASE = '/collect/opcua/:sourceId'
  const records = router.getRoutes()

  it.each(['points', 'browse'])(
    '%s 有自己的地址，可收藏、可后退、刷新还停在这一页',
    (section) => {
      expect(records.map((route) => route.path)).toContain(`${BASE}/${section}`)
    },
  )

  it('进详情默认落到点位，而不是停在一个空壳上', () => {
    const index = records.find((route) => route.path === BASE)
    expect(index?.redirect).toBeDefined()
  })
})

describe('弹窗的对外面', () => {
  it('点位表单收 point 与预填的寻址串，抛建与改两种意图', () => {
    expect(propNames(PointFormDialog).sort()).toEqual([
      'modelValue',
      'point',
      'presetAddress',
    ])
    expect(emitNames(PointFormDialog).sort()).toEqual([
      'create',
      'update',
      'update:modelValue',
    ])
  })

  it('写值弹窗收当前读数——核对现值是下发前唯一的一道人工防线', () => {
    expect(propNames(WriteValueDialog).sort()).toEqual([
      'modelValue',
      'point',
      'sample',
    ])
    expect(emitNames(WriteValueDialog).sort()).toEqual([
      'update:modelValue',
      'write',
    ])
  })

  it('导入弹窗只收数据源 id，已有编码由它自己全量扫', () => {
    expect(propNames(ImportPointsDialog).sort()).toEqual([
      'modelValue',
      'sourceId',
    ])
  })
})

describe('两个小件的对外面', () => {
  it('状态徽标同时收运行态与启用态——两件事不许合成一个灯', () => {
    expect(propNames(SourceStateTag).sort()).toEqual(['isEnabled', 'runtime'])
  })

  it('当前值格收读数与单位', () => {
    expect(propNames(PointValueCell).sort()).toEqual(['sample', 'unit'])
  })
})
