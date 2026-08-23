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
import RecordCell from '@/pages/Dataset/TableDetail/components/RecordCell.vue'
import RecordTable from '@/pages/Dataset/TableDetail/components/RecordTable.vue'
import RecordsPanel from '@/pages/Dataset/TableDetail/components/RecordsPanel.vue'
import TrendPanel from '@/pages/Dataset/TableDetail/components/TrendPanel.vue'
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

describe('数据分区的对外面', () => {
  it('与列配置分区收同样的三个 prop —— 详情页的出口只喂这三个', () => {
    expect(propNames(RecordsPanel).sort()).toEqual(['busy', 'columns', 'table'])
  })

  // ⚠ 分区把列定义原样往下传：详情页那一份是唯一真源，数据表自己再取一次的话，
  // 同一页上会出现两份列定义，而它们不一致时界面不会报任何错（设计 §7.2）
  it('数据表收的是分区传下来的列定义，不自己取列', () => {
    expect(propNames(RecordTable)).toContain('columns')
    expect(emitNames(RecordTable).sort()).toEqual([
      'edit',
      'next',
      'prev',
      'remove',
      'retry',
      'revoke',
    ])
  })

  it('一格收列定义、行与本页样本中位数，撤销只上报不自己发请求', () => {
    expect(propNames(RecordCell).sort()).toEqual([
      'busy',
      'column',
      'median',
      'row',
    ])
    expect(emitNames(RecordCell)).toEqual(['revoke'])
  })
})

describe('趋势分区的对外面', () => {
  it('也收同样的三个 prop —— 详情页的出口对三个分区一视同仁', () => {
    expect(propNames(TrendPanel).sort()).toEqual(['busy', 'columns', 'table'])
  })

  // ⚠ 趋势是只读的一面：它没有任何写动作要往上报，故一个 emit 都不该有。
  // 多出一个就说明有状态漏回了详情页那一层
  it('一个 emit 都没有：这一面只看不改', () => {
    expect(emitNames(TrendPanel)).toEqual([])
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

  it('公式双向绑一行文本，另收错误文案与编辑器要用的那三项', () => {
    // ⚠ 落库的仍然只有 `formula` 这一行文本：另外三项是编辑器要打后端所需的
    // 上下文（打哪张表、编辑的是哪一列、试算结果配哪个单位）
    expect(propNames(ColumnSourceFormula).sort()).toEqual([
      'columnKey',
      'formula',
      'formulaError',
      'tableId',
      'unit',
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

  it('数据分区也有自己的地址：刷新还停在这一页，链接发得出去', () => {
    expect(router.getRoutes().map((route) => route.path)).toContain(
      `${BASE}/records`,
    )
  })

  it('趋势分区同样是一条子路由，而不是页内状态', () => {
    expect(router.getRoutes().map((route) => route.path)).toContain(
      `${BASE}/trend`,
    )
  })

  it('⚠ 趋势分区也只挂读码：写码挂路由会把只读账号整个挡在门外', () => {
    const resolved = router.resolve('/datasets/t1/trend')
    expect(resolved.meta.permissions).toEqual(['dataset:view'])
  })

  it('⚠ 数据分区同样只挂读码：写码挂路由会把只读账号整个挡在门外', () => {
    const resolved = router.resolve('/datasets/t1/records')
    expect(resolved.meta.permissions).toEqual(['dataset:view'])
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

describe('趋势分析页', () => {
  it('有一条静态路径，故它进得了左栏导航', () => {
    expect(router.getRoutes().map((route) => route.path)).toContain('/trend')
  })

  // ⚠ 两个源的读码互不蕴含：点位历史读的是采集面、台账读的是台账面。
  // 按「全都要」放行会把只有其中一个码的账号整个挡在门外，而他本该看得到
  // 自己那一半（docs/DATASET_DESIGN.md §7.1）
  it('⚠ 按两个读码的下界放行：任一即可，不是全都要', () => {
    const resolved = router.resolve('/trend')
    expect([...(resolved.meta.permissions ?? [])].sort()).toEqual([
      'collect:view',
      'dataset:view',
    ])
    expect(resolved.meta.permissionMode).toBe('any')
  })
})
