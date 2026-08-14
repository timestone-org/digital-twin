/**
 * @fileoverview 扫全注册表的不变量：一个模块 = 一个目录、配置键唯一、清单声明的键
 * 与组件真正读的键逐一对上、preview 只提清单里有的键、图标名在 DtIcon 注册表里、
 * 渲染 props 就是固定三件套、three 只能异步进。
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_CONFIG_KEY,
  TWIN_TINT_BINDING_KEY,
} from '@dt/twin-config'
import { isIconName } from '@dt/ui'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Component } from 'vue'
import { beforeAll, describe, expect, it } from 'vitest'

import { registerBuiltinModules } from '../src/registerBuiltins'
import { __resetModules, listModules } from '../src/registry'
import {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
} from '../src/shared/container'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const MODULES_DIR = join(process.cwd(), 'packages', 'modules', 'src', 'modules')

// 组件按常量取键时，扫源码看到的是常量名——这张表把它翻回真正的键
const KEY_CONSTANTS: Record<string, string> = {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_CONFIG_KEY,
  TWIN_TINT_BINDING_KEY,
}

const ACCESS =
  /props\.(?<bag>config|values)(?:\.(?<dot>[A-Za-z_$][\w$]*)|\[\s*(?:'(?<quoted>[^']+)'|(?<ident>[A-Za-z_$][\w$]*))\s*\])/g

const STATIC_THREE = /from\s*['"]@dt\/three-core/

/** 组件源码里真正读到的 `config` / `values` 键。 */
function readKeys(source: string, bag: 'config' | 'values'): string[] {
  const found = new Set<string>()
  for (const match of source.matchAll(ACCESS)) {
    const groups = match.groups
    if (groups?.bag !== bag) continue
    const ident = groups.ident
    const key =
      groups.dot ??
      groups.quoted ??
      (ident === undefined
        ? undefined
        : (KEY_CONSTANTS[ident] ?? `未登记的键常量 ${ident}`))
    if (key !== undefined) found.add(key)
  }
  return [...found].sort()
}

function duplicated(keys: readonly string[]): string[] {
  return keys.filter((key, index) => keys.indexOf(key) !== index)
}

/** 配置字段的键，连子表单一起摊平成「父.子」。 */
function schemaKeys(fields: readonly ConfigField[]): string[] {
  return fields.flatMap((field) => [
    field.key,
    ...schemaKeys(field.fields ?? []).map((child) => `${field.key}.${child}`),
    ...schemaKeys(field.itemSchema ?? []).map(
      (child) => `${field.key}.${child}`,
    ),
  ])
}

/** 绑定槽的键，数组子槽一起摊平。 */
function bindingKeys(specs: readonly BindingSpec[]): string[] {
  return specs.flatMap((spec) => [
    spec.key,
    ...bindingKeys(spec.arrayFields ?? []).map(
      (child) => `${spec.key}.${child}`,
    ),
  ])
}

function propNames(component: Component): string[] {
  const props: unknown = Reflect.get(component, 'props')
  if (Array.isArray(props)) return props.map(String).sort()
  if (typeof props === 'object' && props !== null) {
    return Object.keys(props).sort()
  }
  return []
}

const directories = readdirSync(MODULES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

beforeAll(() => {
  __resetModules()
  registerBuiltinModules()
})

describe('一个模块 = 一个目录', () => {
  it('扫到的目录不是空的，扫描本身没有空转', () => {
    expect(directories).toEqual(['header', 'twin-view'])
  })

  it('每个目录都有清单与渲染组件两个文件', () => {
    const missing = directories.filter(
      (name) =>
        !existsSync(join(MODULES_DIR, name, 'manifest.ts')) ||
        !existsSync(join(MODULES_DIR, name, 'Component.vue')),
    )

    expect(missing).toEqual([])
  })

  it('注册表里的类型与目录名一一对应', () => {
    expect(
      listModules()
        .map((manifest) => manifest.type)
        .sort(),
    ).toEqual(directories)
  })
})

describe('清单自身的不变量', () => {
  it('查重本身认得出重复的键', () => {
    expect(duplicated(['a', 'b', 'a'])).toEqual(['a'])
    expect(duplicated(['a', 'b'])).toEqual([])
  })

  it('配置字段的键在一个模块里唯一', () => {
    const offenders = listModules().flatMap((manifest) =>
      duplicated(schemaKeys(manifest.configSchema)).map(
        (key) => `${manifest.type}.${key}`,
      ),
    )

    expect(offenders).toEqual([])
  })

  it('绑定槽的键在一个模块里唯一', () => {
    const offenders = listModules().flatMap((manifest) =>
      duplicated(bindingKeys(manifest.bindings)).map(
        (key) => `${manifest.type}.${key}`,
      ),
    )

    expect(offenders).toEqual([])
  })

  it('数组槽都声明了行内子槽', () => {
    const offenders = listModules().flatMap((manifest) =>
      manifest.bindings
        .filter(
          (spec) => spec.isArray === true && spec.arrayFields === undefined,
        )
        .map((spec) => `${manifest.type}.${spec.key}`),
    )

    expect(offenders).toEqual([])
  })

  it('图标名都在 DtIcon 注册表里', () => {
    const offenders = listModules()
      .filter(
        (manifest) => manifest.icon !== undefined && !isIconName(manifest.icon),
      )
      .map((manifest) => `${manifest.type}:${manifest.icon ?? ''}`)

    expect(offenders).toEqual([])
  })

  it('预览只提清单里有的键', () => {
    const offenders = listModules().flatMap((manifest) => {
      const configKeys = new Set(schemaKeys(manifest.configSchema))
      const slotKeys = new Set(bindingKeys(manifest.bindings))
      return [
        ...Object.keys(manifest.preview?.config ?? {}).filter(
          (key) => !configKeys.has(key),
        ),
        ...Object.keys(manifest.preview?.values ?? {}).filter(
          (key) => !slotKeys.has(key),
        ),
      ].map((key) => `${manifest.type}.${key}`)
    })

    expect(offenders).toEqual([])
  })
})

describe('声明的键与组件真正读的键', () => {
  it('配置键两侧逐一对上', () => {
    const drift = listModules().map((manifest) => {
      const source = readFileSync(
        join(MODULES_DIR, manifest.type, 'Component.vue'),
        'utf8',
      )
      return {
        type: manifest.type,
        declared: manifest.configSchema.map((field) => field.key).sort(),
        read: readKeys(source, 'config'),
      }
    })

    expect(drift.map((item) => item.read)).toEqual(
      drift.map((item) => item.declared),
    )
  })

  it('绑定槽键两侧逐一对上', () => {
    const drift = listModules().map((manifest) => {
      const source = readFileSync(
        join(MODULES_DIR, manifest.type, 'Component.vue'),
        'utf8',
      )
      return {
        type: manifest.type,
        declared: manifest.bindings.map((spec) => spec.key).sort(),
        read: readKeys(source, 'values'),
      }
    })

    expect(drift.map((item) => item.read)).toEqual(
      drift.map((item) => item.declared),
    )
  })

  it('扫描器认得点号、字符串与常量三种取法', () => {
    const source = [
      'readText(props.config.title)',
      "readBoolean(props.config['showTitle'])",
      'stitch(props.values[TWIN_TINT_BINDING_KEY])',
    ].join('\n')

    expect(readKeys(source, 'config')).toEqual(['showTitle', 'title'])
    expect(readKeys(source, 'values')).toEqual(['tintValues'])
  })

  it('扫描器遇到没登记的键常量会报出来而不是当没看见', () => {
    expect(readKeys('props.config[SOME_UNKNOWN_KEY]', 'config')).toEqual([
      '未登记的键常量 SOME_UNKNOWN_KEY',
    ])
  })
})

describe('渲染组件的形状', () => {
  it('props 就是固定三件套，没有第四个', async () => {
    const shapes = await Promise.all(
      listModules().map(async (manifest) => {
        const loaded = await manifest.component()
        return { type: manifest.type, props: propNames(loaded.default) }
      }),
    )

    expect(shapes.map((item) => item.props)).toEqual(
      shapes.map(() => ['config', 'meta', 'values']),
    )
  })

  it('没有一个组件静态依赖 three', () => {
    const offenders = directories.filter(
      (name) =>
        STATIC_THREE.exec(
          readFileSync(join(MODULES_DIR, name, 'Component.vue'), 'utf8'),
        ) !== null,
    )

    expect(offenders).toEqual([])
  })
})
