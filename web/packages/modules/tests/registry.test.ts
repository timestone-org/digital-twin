/**
 * @fileoverview 守注册中心的公开面：`registerModule` 是机制而不是内置目录的私货——
 * 一份仓外来源的清单注册进来就能被查到；同 type 后注册者生效并经告警槽提一句；
 * 缺 type 直接抛；`defineModule` 零副作用。
 */
import type { ModuleManifest } from '@dt/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __resetModules,
  defineModule,
  getModule,
  listModules,
  registerModule,
  setModuleWarn,
} from '../src/registry'

/** 一份不住在本包目录里的清单，模拟第三方在运行期注册。 */
function foreignManifest(type: string, displayName: string): ModuleManifest {
  return {
    type,
    displayName,
    category: '第三方',
    defaultSize: { width: 240, height: 120 },
    configSchema: [],
    bindings: [],
    component: () => Promise.resolve({ default: { template: '<i />' } }),
  }
}

afterEach(() => {
  __resetModules()
})

describe('运行期注册', () => {
  it('仓外来源的清单注册后能按类型取回，也出现在清单列表里', () => {
    const manifest = foreignManifest('vendor-gauge', '第三方仪表')

    registerModule(manifest)

    expect(getModule('vendor-gauge')).toBe(manifest)
    expect(listModules()).toEqual([manifest])
  })

  it('没注册过的类型取回 undefined', () => {
    expect(getModule('vendor-gauge')).toBeUndefined()
  })

  it('清单列表的顺序就是注册先后', () => {
    const first = foreignManifest('vendor-a', '甲')
    const second = foreignManifest('vendor-b', '乙')

    registerModule(first)
    registerModule(second)

    expect(listModules().map((item) => item.type)).toEqual([
      'vendor-a',
      'vendor-b',
    ])
  })

  it('复位后注册表是空的', () => {
    registerModule(foreignManifest('vendor-a', '甲'))

    __resetModules()

    expect(listModules()).toEqual([])
  })
})

describe('同类型重复注册', () => {
  it('后注册的清单生效', () => {
    const older = foreignManifest('vendor-a', '旧名')
    const newer = foreignManifest('vendor-a', '新名')

    registerModule(older)
    registerModule(newer)

    expect(getModule('vendor-a')).toBe(newer)
    expect(listModules()).toHaveLength(1)
  })

  it('撞了类型要经告警槽说一句', () => {
    const warn = vi.fn()
    setModuleWarn(warn)

    registerModule(foreignManifest('vendor-a', '甲'))
    registerModule(foreignManifest('vendor-a', '乙'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('vendor-a')
  })

  it('同一份清单再注册一次不告警', () => {
    const warn = vi.fn()
    setModuleWarn(warn)
    const manifest = foreignManifest('vendor-a', '甲')

    registerModule(manifest)
    registerModule(manifest)

    expect(warn).not.toHaveBeenCalled()
  })

  it('没装告警槽时重复注册照样成功', () => {
    registerModule(foreignManifest('vendor-a', '甲'))
    registerModule(foreignManifest('vendor-a', '乙'))

    expect(getModule('vendor-a')?.displayName).toBe('乙')
  })
})

describe('缺 type 直接抛', () => {
  it('空串不算类型', () => {
    expect(() => {
      registerModule({ ...foreignManifest('x', '甲'), type: '' })
    }).toThrow('模块清单必须有 type')
  })

  it('全是空白也不算类型', () => {
    expect(() => {
      registerModule({ ...foreignManifest('x', '甲'), type: '   ' })
    }).toThrow('模块清单必须有 type')
  })

  it('压根没有这个字段也抛', () => {
    // ⚠ 第三方可以是纯 JS 调用方，类型系统在那一侧拦不住
    const broken = foreignManifest('x', '甲')
    Reflect.deleteProperty(broken, 'type')

    expect(() => {
      registerModule(broken)
    }).toThrow('模块清单必须有 type')
  })
})

describe('defineModule', () => {
  it('原样返回同一个对象', () => {
    const manifest = foreignManifest('vendor-a', '甲')

    expect(defineModule(manifest)).toBe(manifest)
  })

  it('只收窄类型，自己不注册', () => {
    defineModule(foreignManifest('vendor-a', '甲'))

    expect(listModules()).toEqual([])
  })
})
