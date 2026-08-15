/**
 * @fileoverview 锁住「清单上声明的子编辑器路由真的存在」。
 *
 * ⚠ `ModuleSubEditor.routeName` 写错既不报错也不失败：属性面板照样画出入口按钮，
 * 点下去 `router.push` 抛一个没人看的异常，用户看到的是「点了没反应」。
 * 这条只能靠契约测试兜。顺带把入口的另外两个静默失效点也钉住：
 * 声明的 `configKey` 必须真在这个模块的 `configSchema` 里（不在的话入口永不出现），
 * 而且路由必须同时接 `dashboardId` 与 `nodeId` 两个参数（少一个就跳到一个空页）。
 */
import { listModules, registerBuiltinModules } from '@dt/modules'
import { describe, expect, it } from 'vitest'

import { routes } from '@/router/index'

registerBuiltinModules()

const declared = listModules().flatMap((manifest) =>
  manifest.subEditor === undefined
    ? []
    : [{ type: manifest.type, manifest, subEditor: manifest.subEditor }],
)

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
