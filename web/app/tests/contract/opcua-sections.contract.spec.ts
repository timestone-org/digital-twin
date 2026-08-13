/**
 * @fileoverview 新组件对外面的契约。
 *
 * ⚠ 存在的理由只有一条：**模板里的 prop 名、插槽名、组件注册名写错时，
 * typecheck 与 lint 双双放行**。详情页用 `<component :is>` 往分区里喂
 * `instance`，把某个分区的 prop 改名成别的，编译一路绿，运行时那个分区
 * 收到 undefined，页面白掉——没有任何一道现成的闸门会响。
 */
import { describe, expect, it } from 'vitest'

import AppTabNav from '@/components/layout/AppTabNav.vue'
import NodeExplorer from '@/pages/Tools/OpcuaServerDetail/components/NodeExplorer.vue'
import NodeTree from '@/pages/Tools/OpcuaServerDetail/components/NodeTree.vue'
import SecurityPanel from '@/pages/Tools/OpcuaServerDetail/components/SecurityPanel.vue'
import SessionsPanel from '@/pages/Tools/OpcuaServerDetail/components/SessionsPanel.vue'
import NodeDetailPanel from '@/pages/Tools/OpcuaServerDetail/components/NodeDetailPanel.vue'
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
  ['地址空间', NodeExplorer],
  ['在线会话', SessionsPanel],
  ['接入安全', SecurityPanel],
] as const

describe('详情页三个分区收同一个 prop', () => {
  it.each(SECTIONS)('%s 收 instance', (_label, component) => {
    expect(propNames(component)).toEqual(['instance'])
  })

  it('⚠ 三个分区的 prop 完全一致——详情页只喂一个 `:instance`，多一个就是 undefined', () => {
    const shapes = SECTIONS.map(([, component]) => propNames(component))
    expect(new Set(shapes.map((names) => names.join(',')))).toHaveProperty(
      'size',
      1,
    )
  })
})

describe('分区确实挂在路由上', () => {
  const BASE = '/tools/opcua-servers/:instanceId'
  const records = router.getRoutes()

  it.each(['nodes', 'sessions', 'security'])(
    '%s 有自己的地址，可收藏、可后退、刷新还停在这一页',
    (section) => {
      expect(records.map((route) => route.path)).toContain(`${BASE}/${section}`)
    },
  )

  // ⚠ 用 resolve 而不是 getRoutes()：守卫读的是 `to.meta`，那是全部匹配记录
  // 合并后的结果；normalized record 上的 meta 只是它自己那一条，看不出继承
  it('⚠ 子路由继承父级的权限码——子树不重写一份，两处各写必然漂', () => {
    for (const section of ['nodes', 'sessions', 'security']) {
      const resolved = router.resolve(`/tools/opcua-servers/i1/${section}`)
      expect(resolved.meta.permissions, section).toContain('opcua:view')
    }
  })

  it('进详情默认落到地址空间，而不是停在一个空壳上', () => {
    const index = records.find((route) => route.path === BASE)
    expect(index?.redirect).toBeDefined()
  })
})

describe('AppTabNav 的对外面', () => {
  it('收 items 与 label 两个 prop', () => {
    expect(propNames(AppTabNav).sort()).toEqual(['items', 'label'])
  })

  it('⚠ 不叫 ariaLabel——与 DOM 的 aria-label 同名会让模板里那一行含糊不清', () => {
    expect(propNames(AppTabNav)).not.toContain('ariaLabel')
  })
})

describe('树与详情栏的对外面', () => {
  it('树收 rows 与 selectedId', () => {
    expect(propNames(NodeTree).sort()).toEqual(['rows', 'selectedId'])
  })

  it('树只向上报事件，自己不改选中——选中态归页面持有', () => {
    expect(emitNames(NodeTree).sort()).toEqual([
      'collapse',
      'expand',
      'select',
      'toggle',
    ])
  })

  it('详情栏收 instanceId / node / parentName', () => {
    expect(propNames(NodeDetailPanel).sort()).toEqual([
      'instanceId',
      'node',
      'parentName',
    ])
  })

  it('⚠ 删除只上报，确认与请求都在页面那一层——两处各弹一次确认会重复', () => {
    expect(emitNames(NodeDetailPanel)).toEqual(['remove'])
  })
})
