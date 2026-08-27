/**
 * @fileoverview 契约：2D 孪生文档契约里的每个字段，画东西的那一层真的读过。
 *
 * ⚠ 契约加一个字段、检查器加一个控件，两边都不会报错；只要没人读它，用户就得到
 * 一个配了永远不生效的开关——typecheck 与 lint 双双放行，界面上也没有任何迹象。
 * 这个文件是它反过来那半边（`twin2d-inspector-coverage` 守的是「配得到」，这条守的
 * 是「配了算数」）。
 *
 * ⚠ 扫描的范围不照搬 `twin-config-consumed` 那三个包：2D 这边的标注渲染件
 * （`Twin2dMarkShape.vue`，自称「编辑器与运行态画的是同一份形状」）眼下住在编辑器页
 * 底下，把它漏在外面，整块标注会被判成死字段。反过来，`inspector/` 与 `fields/`
 * 两个目录是**写**侧，放进来这条契约就退化成上一条的同义反复，所以整目录排除。
 *
 * ⚠ 判据比 grep 严一点（认取值、对象键、解构与字符串键），够挡住「只在注释里出现」，
 * 但不分辨是哪个接口的同名字段。它挡的是「全仓没人读」，不是「读错了地方」。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const WEB_ROOT = process.cwd()

/** 文档契约本身：一块画布加五张表，外加图元那一族。 */
const TYPE_FILES = [
  join(WEB_ROOT, 'packages', 'twin2d', 'src', 'types.ts'),
  join(WEB_ROOT, 'packages', 'twin2d', 'src', 'typesPrim.ts'),
]

/** 画东西的那一层，以及为它算数的纯逻辑。 */
const CONSUMER_DIRS = [
  join(WEB_ROOT, 'packages', 'twin2d', 'src'),
  join(WEB_ROOT, 'packages', 'modules', 'src'),
  join(WEB_ROOT, 'app', 'src', 'pages', 'Twin2dEditor', 'components'),
]

/** 契约、归一化与闭合取值表都不算消费：它们只是把字段搬来搬去或者列一遍档位。 */
const NOT_CONSUMERS = [
  'types.ts',
  'typesPrim.ts',
  'normalize',
  'constants.ts',
  'index.ts',
  'kinds.ts',
  'issues',
]

/** 写侧目录：检查器与字段控件往文档里写，不算「画出来了」。 */
const NOT_CONSUMER_DIRS = ['node_modules', 'dist', 'inspector', 'fields']

/** 字段总数下限：类型文件改了形状时正则会静默扫出空表，这道拦住它。 */
const MIN_FIELDS = 200

/** 消费侧文件份数下限：目录改名或后缀变了，扫描器本来会静默空转。 */
const MIN_CONSUMER_FILES = 40

/**
 * 一个目录下的源码文件，递归。
 * @param dir 目录
 */
function sourcesIn(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (NOT_CONSUMER_DIRS.includes(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...sourcesIn(full))
      continue
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.vue')) continue
    if (NOT_CONSUMERS.some((skip) => entry.includes(skip))) continue
    found.push(full)
  }
  return found
}

/** 去掉注释：注释里提到一个字段名不等于读了它。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
}

/** 契约里的一个字段。 */
interface ContractField {
  iface: string
  field: string
}

/** 从类型文件里抽出每个 interface 的顶层字段名。 */
function contractFields(): ContractField[] {
  const found: ContractField[] = []
  for (const file of TYPE_FILES) {
    const text = readFileSync(file, 'utf8')
    for (const block of text.matchAll(
      /export interface (\w+)\s*\{([\s\S]*?)\n\}/g,
    )) {
      const body = stripComments(block[2] ?? '')
      for (const field of body.matchAll(/^\s{2}(\w+)\??\s*:/gm)) {
        found.push({ iface: block[1] ?? '', field: field[1] ?? '' })
      }
    }
  }
  return found
}

const CONSUMER_FILES = CONSUMER_DIRS.flatMap((dir) => sourcesIn(dir))
const HAYSTACK = CONSUMER_FILES.map((file) =>
  stripComments(readFileSync(file, 'utf8')),
).join('\n')
const FIELDS = contractFields()

/**
 * 这个字段名被读过没有。
 * @param field 字段名
 */
function isRead(field: string): boolean {
  return new RegExp(`[.'"\\[]${field}\\b|\\b${field}\\s*[,:}]`).test(HAYSTACK)
}

describe('2D 孪生契约的字段都有人读', () => {
  it('抽得出字段来，别让正则悄悄失效', () => {
    expect(FIELDS.length).toBeGreaterThan(MIN_FIELDS)
    expect(FIELDS.map((item) => item.field)).toContain('nonScalingStroke')
  })

  it('扫到了消费侧的文件，别让扫描器对着空表报绿', () => {
    expect(CONSUMER_FILES.length).toBeGreaterThan(MIN_CONSUMER_FILES)
    expect(
      CONSUMER_FILES.some((file) => file.endsWith('Twin2dMarkShape.vue')),
    ).toBe(true)
  })

  it('写侧的检查器不算消费', () => {
    expect(CONSUMER_FILES.some((file) => file.includes('NodeInspector'))).toBe(
      false,
    )
  })

  it('每个字段都被画东西的那一层读过', () => {
    const dead = FIELDS.filter((item) => !isRead(item.field)).map(
      (item) => `${item.iface}.${item.field}`,
    )

    expect(dead).toEqual([])
  })
})
