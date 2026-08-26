/**
 * @fileoverview 契约：`@dt/twin2d` 的渲染件在模板里传给同族子组件的每个 prop 名，都必须
 * 在那个子组件的 `defineProps` 里存在；子组件的必填 prop 也必须一个不缺。
 *
 * ⚠ 模板里的 prop 名写错，typecheck 与 lint **双双放行**：多出来的名字 Vue 当透传属性
 * 落到根元素上，缺掉的那个在子组件里就是 `undefined`——图元少了盒尺寸会按 1×1 画，
 * 整层挤成一个点，而两边一处报错都没有。这个文件是它们唯一的防线。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const RENDER_DIR = join(process.cwd(), 'packages', 'twin2d', 'src', 'render')
/** 渲染件的份数下限：目录改名或后缀变了就会掉到它以下，而扫描器本来会静默空转 */
const MIN_COMPONENTS = 7

/**
 * `defineProps<{ … }>` 的类型体。
 * ⚠ 非贪婪到第一个 `}>`：props 类型里写内联对象会让这里提前收尾，所以那种写法本来
 * 就被 props 个数闸挡着（它数的是同一段文本的行数）。
 */
const DEFINE_PROPS = /defineProps<\{([\s\S]*?)\}>/
/** 一行一个字段：`name: T` 或 `name?: T` */
const PROP_LINE = /^\s*([A-Za-z_$][\w$]*)(\?)?\s*:/
/** 同族子组件的用法：`<Twin2dXxx …>`，属性段允许跨行但不许出现裸 `>` */
const CHILD_TAG = /<(Twin2d[A-Za-z0-9]*)\b([^>]*)>/g
/**
 * 属性段里的一个属性。
 * ⚠ 取值部分要连引号一起吃掉：`:style="{ a: 1 }"` 里的 `a` 不是属性名，不吃掉就会被
 * 当成一个「传错了的 prop」报出来。
 */
const ATTRIBUTE = /([:@#.]?[A-Za-z][\w:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|\S+))?/g
/** 指令与事件的引子：这些开头的一律不是 prop */
const DIRECTIVE_PREFIXES = ['@', '#', '.', 'v-'] as const
/** 落到根元素上的属性族 */
const ATTR_PREFIXES = ['data-', 'aria-'] as const
/** 透传属性：不是 prop，不参与比对 */
const NOT_A_PROP = new Set([
  'class',
  'style',
  'key',
  'ref',
  'id',
  'is',
  'title',
  'role',
  'tabindex',
  'hidden',
])

interface Component {
  name: string
  file: string
  props: ReadonlySet<string>
  required: ReadonlySet<string>
  template: string
}

/** 一处「谁给谁传了什么」。 */
interface Pass {
  parent: string
  child: string
  prop: string
}

function vueFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...vueFiles(path))
    } else if (entry.endsWith('.vue')) {
      found.push(path)
    }
  }
  return found
}

/** `read-slot` → `readSlot`；模板里两种写法都合法。 */
function camelOf(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  )
}

function propsOf(source: string): {
  props: Set<string>
  required: Set<string>
} {
  const props = new Set<string>()
  const required = new Set<string>()
  const body = DEFINE_PROPS.exec(source)?.[1] ?? ''
  for (const line of body.split('\n')) {
    const match = PROP_LINE.exec(line)
    if (match === null) continue
    const [, name, optional] = match
    if (name === undefined) continue
    props.add(name)
    if (optional === undefined) required.add(name)
  }
  return { props, required }
}

/**
 * SFC 的模板段。
 * ⚠ 取到**最后**一个 `</template>`：模板里嵌 `<template v-for>` 时取第一个会把外层
 * 的其余部分整段丢掉，于是那几处子组件用法一条都扫不到。
 */
function templateOf(source: string): string {
  const start = source.indexOf('<template>')
  const end = source.lastIndexOf('</template>')
  return start < 0 || end < start ? '' : source.slice(start, end)
}

function componentsOf(files: readonly string[]): Component[] {
  return files.map((file) => {
    const source = readFileSync(file, 'utf8')
    const { props, required } = propsOf(source)
    return {
      name: file.split('/').at(-1)?.replace('.vue', '') ?? '',
      file,
      props,
      required,
      template: templateOf(source),
    }
  })
}

/**
 * 一个属性名折算成 prop 名；指令、事件与透传属性回 null。
 * @param raw 模板上原样写的属性名，可能带 `:` / `@` / `#` 引子
 */
function propNameOf(raw: string): string | null {
  const name = raw.startsWith(':') ? raw.slice(1) : raw
  if (DIRECTIVE_PREFIXES.some((prefix) => name.startsWith(prefix))) return null
  if (ATTR_PREFIXES.some((prefix) => name.startsWith(prefix))) return null
  if (name.includes(':') || NOT_A_PROP.has(name)) return null
  return camelOf(name)
}

/** 一处子组件用法上写出来的 prop 名（透传属性与指令已剔除）。 */
function passedProps(attributes: string): string[] {
  const found: string[] = []
  for (const match of attributes.matchAll(ATTRIBUTE)) {
    const name = propNameOf(match[1] ?? '')
    if (name !== null) found.push(name)
  }
  return found
}

/** 每一处同族子组件用法：父件、子件与写出来的 prop 名。 */
function usages(components: readonly Component[]): {
  passes: Pass[]
  pairs: { parent: string; child: string; given: Set<string> }[]
} {
  const known = new Map(components.map((one) => [one.name, one]))
  const passes: Pass[] = []
  const pairs: { parent: string; child: string; given: Set<string> }[] = []
  for (const parent of components) {
    for (const match of parent.template.matchAll(CHILD_TAG)) {
      const child = match[1] ?? ''
      if (!known.has(child)) continue
      const given = new Set(passedProps(match[2] ?? ''))
      pairs.push({ parent: parent.name, child, given })
      for (const prop of given) {
        passes.push({ parent: parent.name, child, prop })
      }
    }
  }
  return { passes, pairs }
}

const FILES = vueFiles(RENDER_DIR)
const COMPONENTS = componentsOf(FILES)
const PROPS_BY_NAME = new Map(COMPONENTS.map((one) => [one.name, one] as const))
const { passes, pairs } = usages(COMPONENTS)

describe('扫描器自检', () => {
  // ⚠ 目录改名、后缀变了或正则失效时，下面每一条断言都会在空集合上通过
  it('渲染件一份不少地扫到了', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(MIN_COMPONENTS)
  })

  it('每个渲染件都提到了模板段', () => {
    const empty = COMPONENTS.filter((one) => one.template === '').map(
      (one) => one.name,
    )

    expect(empty).toEqual([])
  })

  it('至少扫到一处同族子组件用法', () => {
    expect(pairs.length).toBeGreaterThan(0)
    expect(passes.length).toBeGreaterThan(0)
  })

  // 拿一处确定存在的用法钉住 kebab → camel 那一步：正则退化时它先红
  it('kebab 写法折算成 camel 之后能对上', () => {
    const readSlot = passes.filter(
      (pass) => pass.child === 'Twin2dPrimView' && pass.prop === 'readSlot',
    )

    expect(readSlot.length).toBeGreaterThan(0)
  })

  it('必填 prop 的集合真的解析出来了', () => {
    expect([
      ...(PROPS_BY_NAME.get('Twin2dPrimView')?.required ?? []),
    ]).toContain('ctx')
  })
})

describe('模板里传出去的 prop 名', () => {
  it('每一个都在子组件的 defineProps 里', () => {
    const unknown = passes.filter((pass) => {
      const child = PROPS_BY_NAME.get(pass.child)
      return child !== undefined && !child.props.has(pass.prop)
    })

    expect(unknown).toEqual([])
  })
})

describe('子组件的必填 prop', () => {
  // 缺一个必填 prop 时 Vue 只在开发期打一行警告，构建产物里连警告都没有
  it('每一处用法都一个不缺', () => {
    const missing = pairs.flatMap((pair) => {
      const child = PROPS_BY_NAME.get(pair.child)
      if (child === undefined) return []
      return [...child.required]
        .filter((prop) => !pair.given.has(prop))
        .map((prop) => `${pair.parent} → ${pair.child}.${prop}`)
    })

    expect(missing).toEqual([])
  })
})
