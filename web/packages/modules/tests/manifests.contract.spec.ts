/**
 * @fileoverview 扫全注册表的不变量：一个模块 = 一个目录、配置键唯一、清单声明的键
 * 与组件真正读的键逐一对上、preview 只提清单里有的键、图标名在 DtIcon 注册表里、
 * 渲染 props 就是固定三件套、three 只能异步进。
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { INTERACTION_EVENTS, isChromeKey } from '@dt/contracts'
import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_CONFIG_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_PART_FIELD_BINDING_KEY,
  TWIN_PANEL_BINDING_KEY,
  TWIN_PART_BINDING_KEY,
} from '@dt/twin-config'
import {
  TWIN_2D_CONFIG_KEY,
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_STATUS_BINDING_KEY,
} from '@dt/twin2d'
import { isIconName } from '@dt/ui'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Component } from 'vue'
import { beforeAll, describe, expect, it } from 'vitest'

import { BAR_ITEMS_KEY, BAR_SLOT_KEY } from '../src/modules/bar-chart/bars'
import {
  GAUGE_ITEMS_KEY,
  GAUGE_SLOT_KEY,
} from '../src/modules/gauge-card/gauges'
import {
  DATA_CARD_CELLS_KEY,
  DATA_CARD_PARTS_KEY,
  DATA_CARD_SLOT_KEY,
} from '../src/modules/data-card/cells'
import { CARD_ITEMS_KEY, CARD_SLOT_KEY } from '../src/modules/info-card/cells'
import { FEED_SLOT_KEY } from '../src/modules/info-feed/feed'
import { LIST_ITEMS_KEY, LIST_SLOT_KEY } from '../src/modules/info-list/rows'
import {
  SLICE_ITEMS_KEY,
  SLICE_SLOT_KEY,
} from '../src/modules/pie-chart/slices'
import {
  SERIES_ITEMS_KEY,
  SERIES_SLOT_KEY,
} from '../src/modules/trend-chart/series'
import { registerBuiltinModules } from '../src/registerBuiltins'
import { __resetModules, listModules } from '../src/registry'
import {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
} from '../src/shared/container'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const SRC_DIR = join(process.cwd(), 'packages', 'modules', 'src')
const MODULES_DIR = join(SRC_DIR, 'modules')

// 组件按常量取键时，扫源码看到的是常量名——这张表把它翻回真正的键
const KEY_CONSTANTS: Record<string, string> = {
  BAR_ITEMS_KEY,
  BAR_SLOT_KEY,
  CARD_ITEMS_KEY,
  DATA_CARD_CELLS_KEY,
  DATA_CARD_PARTS_KEY,
  DATA_CARD_SLOT_KEY,
  CARD_SLOT_KEY,
  CONTAINER_CONFIG_KEY,
  FEED_SLOT_KEY,
  GAUGE_ITEMS_KEY,
  GAUGE_SLOT_KEY,
  LIST_ITEMS_KEY,
  LIST_SLOT_KEY,
  SERIES_ITEMS_KEY,
  SERIES_SLOT_KEY,
  SHOW_TITLE_CONFIG_KEY,
  SLICE_ITEMS_KEY,
  SLICE_SLOT_KEY,
  TWIN_2D_CONFIG_KEY,
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_STATUS_BINDING_KEY,
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_CONFIG_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_PART_FIELD_BINDING_KEY,
  TWIN_PANEL_BINDING_KEY,
  TWIN_PART_BINDING_KEY,
}

// 一跳前缀（`props.config.x` / `opts.config.x`）也算读：模块的 option 里配置常常
// 是包在上下文对象里往下传的
const ACCESS =
  /(?:[A-Za-z_$][\w$]*\s*\.\s*)?\b(?<bag>config|values)(?:\.(?<dot>[A-Za-z_$][\w$]*)|\[\s*(?:'(?<quoted>[^']+)'|(?<ident>[A-Za-z_$][\w$]*))\s*\])/g

const STATIC_THREE = /from\s*['"]@dt\/three-core/

/** 相对 import 的路径，用来沿着模块目录走到它调用的公共文件。 */
const RELATIVE_IMPORT =
  /from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g

/** 抹掉注释：文件头里提到 `config.data` 是说明，不是消费。 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

/** 源码里真正读到的 `config` / `values` 键。 */
function readKeys(source: string, bag: 'config' | 'values'): string[] {
  const found = new Set<string>()
  for (const match of code(source).matchAll(ACCESS)) {
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

/** 一个模块目录里的渲染侧源文件。清单是声明的那一半，不算消费方。 */
function moduleFiles(type: string): string[] {
  const dir = join(MODULES_DIR, type)
  return readdirSync(dir)
    .filter((name) => name !== 'manifest.ts')
    .filter((name) => name.endsWith('.ts') || name.endsWith('.vue'))
    .map((name) => join(dir, name))
}

/** 把一条相对 import 解析成真实文件；解析不到给 null。 */
function resolveImport(spec: string, from: string): string | null {
  const base = resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.vue`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/**
 * 从模块目录出发沿相对 import 收集包内可达的源文件。
 * ⚠ 「有没有人读这个配置键」必须问到可达集：图表族的 `title` 由公共壳读、
 * `unit` / `palette` 由 chartKit 读，只问模块目录会把它们全判成死字段。
 */
function reachableFiles(seeds: readonly string[]): string[] {
  const seen = new Set<string>()
  const stack = [...seeds]
  while (stack.length > 0) {
    const file = stack.pop()
    if (file === undefined || seen.has(file)) continue
    seen.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const spec = match[1] ?? match[2]
      const target = spec === undefined ? null : resolveImport(spec, file)
      if (target !== null && target.startsWith(SRC_DIR)) stack.push(target)
    }
  }
  return [...seen]
}

/** 一组文件里读到的键的并集。 */
function keysOf(
  files: readonly string[],
  bag: 'config' | 'values',
): Set<string> {
  const found = new Set<string>()
  for (const file of files) {
    for (const key of readKeys(readFileSync(file, 'utf8'), bag)) found.add(key)
  }
  return found
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
    expect(directories).toEqual([
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
    ])
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

  /**
   * 演示配置只走渲染那条路，算子节点原点的排版走的是**不含**它的原始 config。
   * 于是拿它去改标题条或内边距，画布上子节点被顶下去、保存后运行态又是另一个样子——
   * 两边都不报错，只能靠这道闸。
   */
  it('预览不许改容器几何', () => {
    const geometryKeys = new Set([SHOW_TITLE_CONFIG_KEY, CONTAINER_CONFIG_KEY])
    const offenders = listModules().flatMap((manifest) =>
      Object.keys(manifest.preview?.config ?? {})
        .filter((key) => geometryKeys.has(key))
        .map((key) => `${manifest.type}.${key}`),
    )

    expect(offenders).toEqual([])
  })
})

describe('声明的键与渲染侧真正读的键', () => {
  it('扫描本身没有空转——每个模块都扫到了源文件，也扫出了键', () => {
    const scans = listModules().map((manifest) => ({
      type: manifest.type,
      files: moduleFiles(manifest.type).length,
      keys: keysOf(reachableFiles(moduleFiles(manifest.type)), 'config').size,
    }))

    expect(scans.filter((item) => item.files === 0)).toEqual([])
    expect(scans.filter((item) => item.keys === 0)).toEqual([])
  })

  it('没有声明了却没人读的死字段', () => {
    const dead = listModules().flatMap((manifest) => {
      const read = keysOf(reachableFiles(moduleFiles(manifest.type)), 'config')
      return manifest.configSchema
        .filter((field) => !read.has(field.key))
        .map((field) => `${manifest.type}.${field.key}`)
    })

    expect(dead).toEqual([])
  })

  it('没有读了却没声明的暗键', () => {
    const dark = listModules().flatMap((manifest) => {
      const declared = new Set(manifest.configSchema.map((field) => field.key))
      return [...keysOf(moduleFiles(manifest.type), 'config')]
        .filter((key) => !declared.has(key))
        .map((key) => `${manifest.type}.${key}`)
    })

    expect(dark).toEqual([])
  })

  it('绑定槽键两侧逐一对上', () => {
    const drift = listModules().map((manifest) => ({
      type: manifest.type,
      declared: manifest.bindings.map((spec) => spec.key).sort(),
      read: [...keysOf(moduleFiles(manifest.type), 'values')].sort(),
    }))

    expect(drift.map((item) => item.read)).toEqual(
      drift.map((item) => item.declared),
    )
  })

  it('扫描器认得点号、字符串与常量三种取法', () => {
    const source = [
      'readText(props.config.title)',
      "readBoolean(props.config['showTitle'])",
      'stitch(props.values[TWIN_ANCHOR_BINDING_KEY])',
    ].join('\n')

    expect(readKeys(source, 'config')).toEqual(['showTitle', 'title'])
    expect(readKeys(source, 'values')).toEqual(['anchorValues'])
  })

  it('扫描器也认得裸的与包在上下文里的取法', () => {
    const source = [
      'readText(config.unit)',
      'readBoolean(opts.config.smooth)',
    ].join('\n')

    expect(readKeys(source, 'config')).toEqual(['smooth', 'unit'])
  })

  it('扫描器不把注释里提到的键算成消费', () => {
    const source = [
      '// 说明：config.ghost 只是一句散文',
      'readText(config.unit)',
    ].join('\n')

    expect(readKeys(source, 'config')).toEqual(['unit'])
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

describe('壳适配声明的不变量', () => {
  // ⚠ 键名写错 typecheck 报不了（联合类型也挡不住漂移后的清单重排），
  //   面板拿它去隐藏字段，错键 = 该藏的没藏、面板照常渲染
  it('unsupportedChromeKeys 只登记 CHROME_KEYS 里的键，且不重复', () => {
    const offenders = listModules().flatMap((manifest) => {
      const keys = manifest.unsupportedChromeKeys ?? []
      const stray = keys.filter((key) => !isChromeKey(key))
      const duplicated = keys.length !== new Set(keys).size
      return stray.length > 0 || duplicated
        ? [`${manifest.type}: ${stray.join(',') || '重复键'}`]
        : []
    })

    expect(offenders).toEqual([])
  })

  it('interactionEvents 只登记契约里的事件名，且不重复', () => {
    const known = new Set<string>(INTERACTION_EVENTS)
    const offenders = listModules().flatMap((manifest) => {
      const events = manifest.interactionEvents ?? []
      const stray = events.filter((event) => !known.has(event))
      const duplicated = events.length !== new Set(events).size
      return stray.length > 0 || duplicated
        ? [`${manifest.type}: ${stray.join(',') || '重复事件'}`]
        : []
    })

    expect(offenders).toEqual([])
  })
})

/**
 * 面板上默认占整行的那几档：形状本来就宽（多行文本、图、子表单、行列表），
 * 缺 `span` 是对的。其余是紧凑控件，缺 `span` 就等于**默认铺满一整行**，
 * 而作者八成只是忘了写——页头曾因此有 11 个控件各占一整行。
 */
const WIDE_FIELD_TYPES = new Set<ConfigField['type']>([
  'array',
  'object',
  'textarea',
  'image',
  'json',
  'font',
  'style',
  'dashboard-ref',
])

describe('条件显示与栅格的不变量', () => {
  // ⚠ 指错键的 `when` 恒不满足（配置里取不到那个键），表现是那个字段
  //   **永远不出现**在面板上，而 typecheck 与 lint 双双放行
  it('when 指向的键在同一层里真的存在', () => {
    const offenders = listModules().flatMap((manifest) =>
      danglingConditions(manifest.configSchema).map(
        (text) => `${manifest.type}.${text}`,
      ),
    )

    expect(offenders).toEqual([])
  })

  // ⚠ 名单外的取值恒不命中，同上：那个字段永远不出现，且没有任何一处报错
  it('when 判的取值都在控制字段的 options 名单里', () => {
    const offenders = listModules().flatMap((manifest) =>
      strayConditionValues(manifest.configSchema).map(
        (text) => `${manifest.type}.${text}`,
      ),
    )

    expect(offenders).toEqual([])
  })

  it('紧凑控件都显式声明了 span', () => {
    const offenders = listModules().flatMap((manifest) =>
      manifest.configSchema
        .filter(
          (field) =>
            !WIDE_FIELD_TYPES.has(field.type) && field.span === undefined,
        )
        .map((field) => `${manifest.type}.${field.key}(${field.type})`),
    )

    expect(offenders).toEqual([])
  })
})

/** `when` 指向同层里并不存在的键的那些字段，逐层递归。 */
function danglingConditions(fields: readonly ConfigField[]): string[] {
  const keys = new Set(fields.map((field) => field.key))
  const out: string[] = []
  for (const field of fields) {
    if (field.when !== undefined && !keys.has(field.when.key)) {
      out.push(`${field.key} → ${field.when.key}`)
    }
    out.push(...danglingConditions(field.fields ?? []))
    out.push(...danglingConditions(field.itemSchema ?? []))
  }
  return out
}

/** `when` 判的取值落在控制字段 `options` 名单之外的那些字段，逐层递归。 */
function strayConditionValues(fields: readonly ConfigField[]): string[] {
  const byKey = new Map(fields.map((field) => [field.key, field]))
  const out: string[] = []
  for (const field of fields) {
    const condition = field.when
    const parent = condition && byKey.get(condition.key)
    if (condition !== undefined && parent?.options !== undefined) {
      const allowed = new Set(parent.options.map((option) => option.value))
      const stray = condition.in.filter((value) => !allowed.has(value))
      if (stray.length > 0) {
        out.push(`${field.key} → ${condition.key} in ${stray.join(',')}`)
      }
    }
    out.push(...strayConditionValues(field.fields ?? []))
    out.push(...strayConditionValues(field.itemSchema ?? []))
  }
  return out
}
