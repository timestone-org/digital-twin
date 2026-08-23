/**
 * @fileoverview 分区组件对外面与路由的契约。
 *
 * ⚠ 存在的理由只有一条：**模板里的 prop 名、插槽名、组件注册名写错时，
 * typecheck 与 lint 双双放行**。详情页用 `<component :is>` 往分区里喂
 * table / columns / busy，把某个名字改掉，编译一路绿，运行时那个分区收到
 * undefined，页面白掉——没有任何一道现成的闸门会响。
 */
import { describe, expect, it } from 'vitest'

import ColumnList from '@/pages/Dataset/TableDetail/components/ColumnList.vue'
import ColumnsPanel from '@/pages/Dataset/TableDetail/components/ColumnsPanel.vue'
import ColumnSourceFormula from '@/pages/Dataset/TableDetail/components/ColumnSourceFormula.vue'
import ColumnSourceManual from '@/pages/Dataset/TableDetail/components/ColumnSourceManual.vue'
import ColumnSourcePoint from '@/pages/Dataset/TableDetail/components/ColumnSourcePoint.vue'
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

/**
 * 组件收的 prop 名。
 * ⚠ 滤掉 `xxxModifiers`：`defineModel` 会替每个模型顺带声明一个修饰符 prop，
 * 它是 Vue 自己的实现细节，不是这个组件的对外面。
 * @param component 组件本身
 */
function propNames(component: unknown): string[] {
  return faceNames(component, 'props').filter(
    (name) => !name.endsWith('Modifiers'),
  )
}

function emitNames(component: unknown): string[] {
  return faceNames(component, 'emits')
}

describe('列配置分区的对外面', () => {
  it('收 table / columns / busy —— 详情页喂的就是这三个', () => {
    expect(propNames(ColumnsPanel).sort()).toEqual(['busy', 'columns', 'table'])
  })

  it('⚠ 分区只 emit 不自取数：状态只在详情页那一份（设计 §7.2）', () => {
    expect(emitNames(ColumnsPanel).sort()).toEqual(['edit', 'move', 'remove'])
  })

  it('表格与分区的事件逐字一致——分区只是把它们原样往上传', () => {
    expect(emitNames(ColumnList).sort()).toEqual(emitNames(ColumnsPanel).sort())
  })
})

describe('三个来源子块的对外面', () => {
  it('人工录入收数据类型，双向绑默认值与必填', () => {
    expect(propNames(ColumnSourceManual).sort()).toEqual([
      'dataType',
      'defaultValue',
      'isRequired',
    ])
  })

  it('点位汇总双向绑点位标识与聚合口径，另收一格错误文案', () => {
    expect(propNames(ColumnSourcePoint).sort()).toEqual([
      'agg',
      'nodeKey',
      'nodeKeyError',
    ])
  })

  it('公式双向绑一行文本，另收一格错误文案', () => {
    expect(propNames(ColumnSourceFormula).sort()).toEqual([
      'formula',
      'formulaError',
    ])
  })
})

describe('分区确实挂在路由上', () => {
  const BASE = '/datasets/:tableId'

  it('列配置有自己的地址，可收藏、可后退、刷新还停在这一页', () => {
    expect(router.getRoutes().map((route) => route.path)).toContain(
      `${BASE}/columns`,
    )
  })

  // ⚠ 用 resolve 而不是 getRoutes()：守卫读的是 `to.meta`，那是全部匹配记录
  // 合并后的结果；normalized record 上的 meta 只是它自己那一条，看不出继承
  it('⚠ 子路由继承父级的权限码——子树不重写一份，两处各写必然漂', () => {
    const resolved = router.resolve('/datasets/t1/columns')
    expect(resolved.meta.permissions).toContain('dataset:view')
  })

  it('⚠ 详情只挂读码：写码挂到路由上会把只读账号整个挡在门外', () => {
    const resolved = router.resolve('/datasets/t1/columns')
    expect(resolved.meta.permissions).not.toContain('dataset:manage')
  })

  it('进详情默认落到列配置，而不是停在一个空壳上', () => {
    const index = router.getRoutes().find((route) => route.path === BASE)
    expect(index?.redirect).toBeDefined()
  })

  it('带 :tableId 的详情路由不进左栏导航——那张表每一项都要有静态路径', () => {
    const resolved = router.resolve('/datasets/t1/columns')
    expect(resolved.name).toBe('dataset-table-columns')
  })
})
