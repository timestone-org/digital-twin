/**
 * @fileoverview 守内置模块的自动发现：glob 扫到的每份清单都进注册表、顺序确定、
 * 可重复调用，且目录在而默认导出不在时响亮失败——静默跳过的表现是
 * 「这个模块从模块库里消失了」，而没有任何一处报错。
 */
import type { ModuleManifest } from '@dt/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { registerBuiltinModules } from '../src/registerBuiltins'
import { __resetModules, listModules } from '../src/registry'

function stubManifest(type: string): ModuleManifest {
  return {
    type,
    displayName: type,
    category: '测试',
    defaultSize: { width: 100, height: 100 },
    configSchema: [],
    bindings: [],
    component: () => Promise.resolve({ default: { template: '<i />' } }),
  }
}

afterEach(() => {
  __resetModules()
})

/** 目录即清单，故这份名单与 `src/modules/` 下的目录一一对应。 */
const BUILTIN_TYPES = [
  'action-button',
  'bar-chart',
  'container',
  'data-card',
  'footer',
  'gauge-card',
  'header',
  'image-block',
  'info-card',
  'info-feed',
  'info-list',
  'nav-tabs',
  'pie-chart',
  'text-block',
  'trend-chart',
  'twin-2d-view',
  'twin-view',
]

describe('内置模块的自动发现', () => {
  it('每个内置模块目录都被注册', () => {
    registerBuiltinModules()

    expect(
      listModules()
        .map((item) => item.type)
        .sort(),
    ).toEqual(BUILTIN_TYPES)
  })

  it('重复调用不会把模块注册成两份', () => {
    registerBuiltinModules()
    registerBuiltinModules()

    expect(listModules()).toHaveLength(BUILTIN_TYPES.length)
  })

  it('注册顺序按文件路径排序，两次运行一致', () => {
    registerBuiltinModules({
      './modules/zeta/manifest.ts': { default: stubManifest('zeta') },
      './modules/alpha/manifest.ts': { default: stubManifest('alpha') },
    })

    expect(listModules().map((item) => item.type)).toEqual(['alpha', 'zeta'])
  })

  it('目录在而默认导出不在时抛出，指名是哪一个目录', () => {
    expect(() => {
      registerBuiltinModules({ './modules/ghost/manifest.ts': {} })
    }).toThrow('./modules/ghost/manifest.ts')
  })
})
