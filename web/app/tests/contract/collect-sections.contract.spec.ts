/**
 * @fileoverview 采集主从单页对外面的契约。
 *
 * ⚠ 存在的理由只有一条：**模板里的 prop 名、插槽名、组件注册名写错时，
 * typecheck 与 lint 双双放行**。主从页往两个分区里喂 `source`，把某个分区的
 * prop 改名成别的，编译一路绿，运行时那个分区收到 undefined，页面白掉——
 * 没有任何一道现成的闸门会响。
 */
import { describe, expect, it } from 'vitest'

import BrowsePanel from '@/pages/Collect/Opcua/components/BrowsePanel.vue'
import ForceDeleteDialog from '@/pages/Collect/Opcua/components/ForceDeleteDialog.vue'
import ImportNodesDialog from '@/pages/Collect/Opcua/components/ImportNodesDialog.vue'
import ImportPointsDialog from '@/pages/Collect/Opcua/components/ImportPointsDialog.vue'
import NodeTable from '@/pages/Collect/Opcua/components/NodeTable.vue'
import PointFormDialog from '@/pages/Collect/Opcua/components/PointFormDialog.vue'
import PointValueCell from '@/pages/Collect/Opcua/components/PointValueCell.vue'
import RuntimeParamsDialog from '@/components/runtime/RuntimeParamsDialog.vue'
import SourceFormDialog from '@/pages/Collect/Opcua/components/SourceFormDialog.vue'
import SourceListItem from '@/pages/Collect/Opcua/components/SourceListItem.vue'
import SourceStateTag from '@/pages/Collect/Opcua/components/SourceStateTag.vue'
import WriteValueDialog from '@/pages/Collect/Opcua/components/WriteValueDialog.vue'
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

const PANELS = [
  ['已导入节点', NodeTable],
  ['在线浏览', BrowsePanel],
] as const

describe('主从页两个分区收同一个 prop', () => {
  it.each(PANELS)('%s 收 source', (_label, component) => {
    expect(propNames(component)).toEqual(['source'])
  })
})

describe('主从单页挂在路由上', () => {
  it('/collect/opcua 是一整页，不再有 :sourceId 详情子路由', () => {
    const paths = router.getRoutes().map((route) => route.path)
    expect(paths).toContain('/collect/opcua')
    expect(paths.some((path) => path.startsWith('/collect/opcua/:'))).toBe(
      false,
    )
  })
})

describe('弹窗的对外面', () => {
  it('数据源表单收 source（编辑态），抛建与改两种意图', () => {
    expect(propNames(SourceFormDialog).sort()).toEqual(['modelValue', 'source'])
    expect(emitNames(SourceFormDialog).sort()).toEqual([
      'create',
      'update',
      'update:modelValue',
    ])
  })

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

  it('CSV 导入弹窗只收数据源 id，已有编码由它自己全量扫', () => {
    expect(propNames(ImportPointsDialog).sort()).toEqual([
      'modelValue',
      'sourceId',
    ])
  })

  it('浏览导入弹窗收草稿与已用编码——判重要同时看本批与库里', () => {
    expect(propNames(ImportNodesDialog).sort()).toEqual([
      'drafts',
      'loading',
      'modelValue',
      'takenCodes',
    ])
    expect(emitNames(ImportNodesDialog).sort()).toEqual([
      'confirm',
      'update:modelValue',
    ])
  })

  it('强删弹窗以 conflict 非空进入二级确认，confirm 带 force 布尔', () => {
    expect(propNames(ForceDeleteDialog).sort()).toEqual([
      'conflict',
      'loading',
      'message',
      'modelValue',
      'name',
      'title',
    ])
    expect(emitNames(ForceDeleteDialog).sort()).toEqual([
      'confirm',
      'update:modelValue',
    ])
  })

  it('运行参数弹窗按 section 复用于采集与归档两组', () => {
    expect(propNames(RuntimeParamsDialog).sort()).toEqual([
      'intro',
      'modelValue',
      'section',
      'title',
    ])
  })
})

describe('小件的对外面', () => {
  it('状态徽标同时收运行态与启用态——两件事不许合成一个灯', () => {
    expect(propNames(SourceStateTag).sort()).toEqual(['isEnabled', 'runtime'])
  })

  it('当前值格收读数与单位', () => {
    expect(propNames(PointValueCell).sort()).toEqual(['sample', 'unit'])
  })

  it('源条目收 source 与选中态，点击抛 select', () => {
    expect(propNames(SourceListItem).sort()).toEqual(['active', 'source'])
    expect(emitNames(SourceListItem)).toEqual(['select'])
  })
})
