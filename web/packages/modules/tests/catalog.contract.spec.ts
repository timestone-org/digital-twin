/**
 * @fileoverview 锁死模块清单两侧一致：服务端的 `module_types.json` 必须逐字等于
 * 本仓清单的序列化结果。⚠ 这一份漂了不会有任何报错——服务端按过期目录校验
 * `field_key`，新绑定被拒；Agent 按过期目录生成配置，前端渲染成空白（ADR-0012 五）。
 *
 * 目录变了就重新生成：`pnpm vitest run packages/modules/tests/catalog.contract.spec.ts -u`
 */
import { BINDING_DATA_TYPES, CONFIG_FIELD_TYPES } from '@dt/contracts'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import type { CatalogJson } from '../src/catalog'
import { buildModuleCatalog } from '../src/catalog'
import { registerBuiltinModules } from '../src/registerBuiltins'
import { __resetModules, listModules } from '../src/registry'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const CATALOG_FILE = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'src',
  'platform_server',
  'apps',
  'dashboard',
  'module_types.json',
)

function serialized(): string {
  return `${JSON.stringify(buildModuleCatalog(listModules()), null, 2)}\n`
}

beforeAll(() => {
  __resetModules()
  registerBuiltinModules()
})

describe('模块清单的两侧一致', () => {
  // 整份逐字比对：模块增删、配置键改名、绑定槽改形状全都落在这一条上
  it('服务端目录就是本仓清单的序列化结果', async () => {
    await expect(serialized()).toMatchFileSnapshot(CATALOG_FILE)
  })

  // unsupportedChromeKeys / interactionEvents 是编辑器面板的适配声明，服务端
  // 没有消费点——序列化它们只会让 module_types.json 平白多一段要跨仓同步的 diff
  it('编辑器侧的适配声明不进服务端目录', () => {
    const text = serialized()

    expect(text).not.toContain('unsupported_chrome_keys')
    expect(text).not.toContain('unsupportedChromeKeys')
    expect(text).not.toContain('interaction_events')
    expect(text).not.toContain('interactionEvents')
  })

  // 画布与运行时的东西：序列化了也只是让 Agent 拿到一份它用不上的演示数据，
  // 还会被误当成真配置照抄
  it('画布侧的演示数据不进服务端目录', () => {
    const text = serialized()

    expect(text).not.toContain('"preview"')
    expect(text).not.toContain('"component"')
  })
})

/**
 * ⚠ 这一组守的是「模型读得到怎么配」那一半。三段各自漏掉的表现都是静默的：
 * 少了预设，模型只能逐个字段去凑一套观感（十几个键，漏一个也看不出漏在哪）；
 * 少了 `sub_editor`，它会照着猜往子编辑器那一段里写，而写进去既不报错也不渲染；
 * 少了图例，它只能猜每一格 `type` 是什么形状的值。
 */
describe('给模型读的那几段', () => {
  it('预设连同它的值一起序列化', () => {
    const catalog = buildModuleCatalog(listModules())
    const declared = listModules().filter(
      (manifest) => (manifest.configPresets ?? []).length > 0,
    )
    const serializedCount = modulesOf(catalog).filter((module) =>
      Array.isArray(module.config_presets),
    )

    expect(declared.length).toBeGreaterThan(0)
    expect(serializedCount).toHaveLength(declared.length)
    for (const module of serializedCount) {
      for (const preset of module.config_presets as CatalogJson[]) {
        expect(typeof preset.id).toBe('string')
        expect(typeof preset.config).toBe('object')
      }
    }
  })

  it('子编辑器声明序列化，且指名它接管哪个配置键', () => {
    const catalog = buildModuleCatalog(listModules())
    const declared = listModules().filter(
      (manifest) => manifest.subEditor !== undefined,
    )
    const serializedOnes = modulesOf(catalog).filter(
      (module) => module.sub_editor !== undefined,
    )

    expect(declared.length).toBeGreaterThan(0)
    expect(serializedOnes).toHaveLength(declared.length)
    for (const module of serializedOnes) {
      const editor = module.sub_editor as CatalogJson
      const keys = (module.config_schema as CatalogJson[]).map(
        (field) => field.key,
      )
      // 指了一个清单里没有的键 = 属性面板永远开不出那个入口
      expect(keys).toContain(editor.config_key)
    }
  })

  it('出厂配置序列化', () => {
    const catalog = buildModuleCatalog(listModules())
    const declared = listModules().filter(
      (manifest) => manifest.defaultConfig !== undefined,
    )
    const serializedOnes = modulesOf(catalog).filter(
      (module) => module.default_config !== undefined,
    )

    expect(declared.length).toBeGreaterThan(0)
    expect(serializedOnes).toHaveLength(declared.length)
  })

  it('两张图例逐档铺满，且摆在模块表之前', () => {
    const catalog = buildModuleCatalog(listModules())
    const fieldTypes = catalog.field_types as CatalogJson[]
    const dataTypes = catalog.binding_data_types as CatalogJson[]

    expect(fieldTypes.map((one) => one.type).sort()).toEqual(
      [...CONFIG_FIELD_TYPES].sort(),
    )
    expect(dataTypes.map((one) => one.type).sort()).toEqual(
      [...BINDING_DATA_TYPES].sort(),
    )
    for (const row of [...fieldTypes, ...dataTypes]) {
      const doc = row.doc
      expect(typeof doc).toBe('string')
      expect(typeof doc === 'string' ? doc.length : 0).toBeGreaterThan(10)
    }
    // 被上下文截断时先没的不该是读表的图例
    const keys = Object.keys(catalog)
    expect(keys.indexOf('field_types')).toBeLessThan(keys.indexOf('modules'))
  })
})

/** 目录里的模块表，收窄成对象数组。 */
function modulesOf(catalog: CatalogJson): CatalogJson[] {
  const modules = catalog.modules
  return Array.isArray(modules) ? (modules as CatalogJson[]) : []
}
