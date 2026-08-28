/**
 * @fileoverview 锁住 2D 孪生子编辑器读的那两个**模块**配置键，与 `twin-2d-view` 清单
 * 声明的键逐字相同。
 *
 * ⚠ 这是一条跨包的暗接线：子编辑器住在 `app/`，键声明在 `packages/modules/` 的清单里，
 * 两处各写一份字面量。拼错的那一份读不到值就**静默退回缺省**，界面上于是按一个谁也
 * 没配过的档位算出「1:1」，而 typecheck、lint 与两边的单测一律放行。
 * ⚠ 只守「读的键存在」这一半；这一页从不写它们（写回去就得让子编辑器认得自己在编
 * 哪个模块），所以另一半是「清单里那两个键的默认值口径」，归模块自己的用例。
 */
import { getModule, registerBuiltinModules } from '@dt/modules'
import { beforeAll, describe, expect, it } from 'vitest'

import { TWIN_2D_HOST_FIT_KEYS } from '@/pages/Twin2dEditor/scripts/hostFit'

/** 子编辑器编的就是这个模块；清单里的 `subEditor` 指回本页那条路由。 */
const MODULE_TYPE = 'twin-2d-view'

beforeAll(() => {
  registerBuiltinModules()
})

describe('子编辑器读的模块配置键', () => {
  it('清单确实注册进来了（注册不上就等于这条闸没跑）', () => {
    expect(getModule(MODULE_TYPE)?.configSchema.length).toBeGreaterThan(0)
  })

  it('每一个都在清单的 configSchema 里', () => {
    const declared = new Set(
      (getModule(MODULE_TYPE)?.configSchema ?? []).map((field) => field.key),
    )

    const missing = Object.values(TWIN_2D_HOST_FIT_KEYS).filter(
      (key) => !declared.has(key),
    )
    expect(missing).toEqual([])
  })

  it('这一页正是那个模块的子编辑器，读它的键才算数', () => {
    expect(getModule(MODULE_TYPE)?.subEditor?.routeName).toBe('twin-2d-editor')
  })
})
