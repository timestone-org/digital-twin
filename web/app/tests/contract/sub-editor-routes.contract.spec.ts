/**
 * @fileoverview 锁住「清单上声明的子编辑器真的打得开」。
 *
 * ⚠ `ModuleSubEditor.routeName` 写错既不报错也不失败：属性面板照样画出入口按钮，
 * 点下去 `router.push` 抛一个没人看的异常，用户看到的是「点了没反应」。
 * 这条只能靠契约测试兜。顺带把入口的另外两个静默失效点也钉住：
 * 声明的 `configKey` 必须真在这个模块的 `configSchema` 里（不在的话入口永不出现），
 * 而且路由必须同时接 `dashboardId` 与 `nodeId` 两个参数（少一个就跳到一个空页）。
 * 最后把「按钮 → 入口 → 真路由表」这一段整个走一遍：三条静态检查各自都绿、
 * 连起来仍可能跳不动（面板没画按钮、参数没喂上），只有点一次才看得出来。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import {
  __resetConfigControls,
  listModules,
  registerBuiltinModules,
} from '@dt/modules'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { computed, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { RouteRecordRaw, Router } from 'vue-router'

import { installConfigControls } from '@/features/dashboard/configControls'
import PropertyPanel from '@/pages/DashboardEditor/components/PropertyPanel.vue'
import { useSubEditorEntry } from '@/pages/DashboardEditor/scripts/useSubEditorEntry'
import { routes } from '@/router/index'

registerBuiltinModules()

const declared = listModules().flatMap((manifest) =>
  manifest.subEditor === undefined
    ? []
    : [{ type: manifest.type, manifest, subEditor: manifest.subEditor }],
)

/** 被编辑的那个节点：入口只从它身上取 id 与大屏 id。 */
const NODE: DashboardNodePayload = {
  id: 'node-1',
  dashboardId: 'dash-1',
  parentId: null,
  clientKey: null,
  moduleType: 'demo',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  zIndex: 0,
  isVisible: true,
  configJson: {},
  createdAt: '',
  updatedAt: '',
  bindings: [],
}

/** 页面组件的空壳。 */
const Blank = defineComponent({ name: 'BlankPage', render: () => null })

/**
 * 只借真路由表的路径与名字，页面组件一律换成空壳——点一下入口就把子编辑器整页
 * （连同它的三维依赖）拉进测试进程，是这条契约最容易变成随机红灯的地方。
 */
function stubRouter(): Router {
  const records: RouteRecordRaw[] = routes.flatMap((route) =>
    route.name === undefined
      ? []
      : [{ path: route.path, name: route.name, component: Blank }],
  )
  return createRouter({ history: createMemoryHistory(), routes: records })
}

/** 装上入口的属性面板：点掉那个按钮，返回跳完之后的路由。 */
async function clickEntry(manifest: ModuleManifest): Promise<Router> {
  const router = stubRouter()
  const Host = defineComponent({
    name: 'EntryHost',
    setup() {
      useSubEditorEntry({
        dashboardId: () => NODE.dashboardId,
        selectedId: computed(() => NODE.id),
        isDirty: () => false,
        save: () => Promise.resolve(),
        confirm: { ask: () => Promise.resolve(true) },
        toast: { error: () => undefined },
      })
      return () => h(PropertyPanel, { node: NODE, manifest })
    },
  })

  const wrapper = mount(Host, { global: { plugins: [router] } })
  const button = wrapper
    .findAll('button')
    .find((item) => item.text() === manifest.subEditor?.label)
  expect(button).toBeDefined()
  await button?.trigger('click')
  await flushPromises()
  return router
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('子编辑器的声明', () => {
  it('至少有一个模块声明了子编辑器，否则这条契约在空跑', () => {
    expect(declared.length).toBeGreaterThan(0)
  })

  it.each(declared)('$type 的路由名在路由表里存在', ({ subEditor }) => {
    const names = routes.map((route) => route.name)
    expect(names).toContain(subEditor.routeName)
  })

  it.each(declared)('$type 的路由接 dashboardId 与 nodeId', ({ subEditor }) => {
    const route = routes.find((item) => item.name === subEditor.routeName)
    expect(route?.path).toContain(':dashboardId')
    expect(route?.path).toContain(':nodeId')
  })

  it.each(declared)(
    '$type 声明的 configKey 在它自己的 schema 里',
    ({ manifest, subEditor }) => {
      const keys = manifest.configSchema.map((field) => field.key)
      expect(keys).toContain(subEditor.configKey)
    },
  )
})

describe('入口真的跳得过去', () => {
  it.each(declared)(
    '$type 的入口按钮点下去落在它声明的那一页',
    async ({ manifest, subEditor }) => {
      const router = await clickEntry(manifest)

      expect(router.currentRoute.value.name).toBe(subEditor.routeName)
    },
  )

  // 参数没喂上时路由照样匹配得到，跳过去的却是一个没有大屏也没有节点的空页
  it.each(declared)(
    '$type 跳过去时带上大屏与节点两个参数',
    async ({ manifest }) => {
      const router = await clickEntry(manifest)

      expect(router.currentRoute.value.params).toEqual({
        dashboardId: NODE.dashboardId,
        nodeId: NODE.id,
      })
    },
  )
})
