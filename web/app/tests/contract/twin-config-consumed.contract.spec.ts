/**
 * @fileoverview 锁住「孪生契约里的字段，渲染层真的读过」。
 *
 * ⚠ 契约加一个字段、编辑器加一个控件，两边都不会报错；只要渲染层没人读它，
 * 用户就得到一个配了永远不生效的开关——typecheck 与 lint 双双放行，界面上
 * 也没有任何迹象。这个文件是它们唯一的防线。
 *
 * 几处历史欠账正是这么来的：`isDefault` 的选择函数写好了却只有测试在用、
 * `showGroundGrid` 全仓只有一句「不看这个开关」的注释、`viewpoints` 整块零实现、
 * `billboard` 因为牌是 CSS2D 而画不出来（后来把牌换成 CSS3D 才补上）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const WEB_ROOT = process.cwd()
const TYPES_FILE = join(WEB_ROOT, 'packages', 'twin-config', 'src', 'types.ts')

/** 渲染侧：运行态真正画东西、以及为它算数的纯逻辑。 */
const CONSUMER_DIRS = [
  join(WEB_ROOT, 'packages', 'three-core', 'src'),
  join(WEB_ROOT, 'packages', 'modules', 'src'),
  join(WEB_ROOT, 'packages', 'twin-config', 'src'),
]

/** 契约与归一化本身不算消费：那只是把字段搬来搬去。 */
const NOT_CONSUMERS = ['types.ts', 'normalize', 'constants.ts', 'index.ts']

/**
 * 只由编辑器消费、渲染层本来就不该读的字段。
 * ⚠ 往这里加之前先问一句「用户配了它，画面上会变吗」——会变就不是豁免，是缺陷。
 */
const EDITOR_ONLY = new Set([
  // 大纲里的排序与命名，纯编辑期概念
  'order',
  // 大纲文件夹：编辑器左栏的纯展示分组，渲染层本就不该读
  'folders',
  // 文件夹的成员表，同上
  'itemIds',
])

/**
 * 渲染方式决定了实现不了、已经拍板留着的字段。
 * ⚠ 不是「以后再说」的清单：留在这里的每一条都要说清为什么画不出来。
 */
const KNOWN_DEAD = new Map<string, string>([
  [
    'originalMaterials',
    '本项目从不做统一提亮，恒等于 true 的行为；要让 false 有意义得先有材质增强',
  ],
  [
    'reflection',
    '三档一律按 none 处理：soft/mirror 要么加一次离屏反射渲染、要么上实时环境贴图，' +
      '都是每帧多渲一遍场景的开销，而底座只是暗场展示的装饰件（见 sceneEffects.ts）',
  ],
])

function sourcesIn(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
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

function consumerText(): string {
  return CONSUMER_DIRS.flatMap((dir) => sourcesIn(dir))
    .map((file) => stripComments(readFileSync(file, 'utf8')))
    .join('\n')
}

/** 从 types.ts 抽出每个 interface 的字段名。 */
function contractFields(): { iface: string; field: string }[] {
  const text = readFileSync(TYPES_FILE, 'utf8')
  const found: { iface: string; field: string }[] = []
  for (const block of text.matchAll(
    /export interface (\w+)\s*\{([\s\S]*?)\n\}/g,
  )) {
    const body = stripComments(block[2] ?? '')
    for (const field of body.matchAll(/^\s*(\w+)\??\s*:/gm)) {
      found.push({ iface: block[1] ?? '', field: field[1] ?? '' })
    }
  }
  return found
}

const HAYSTACK = consumerText()
const FIELDS = contractFields()

function isRead(field: string): boolean {
  // 认 `.field`、`field:`、解构与字符串键；比 grep 严一点，够挡住「只在注释里出现」
  return new RegExp(`[.'"\\[]${field}\\b|\\b${field}\\s*[,:}]`).test(HAYSTACK)
}

describe('孪生契约的字段都有人读', () => {
  it('抽得出字段来，别让正则悄悄失效', () => {
    expect(FIELDS.length).toBeGreaterThan(50)
    expect(FIELDS.map((item) => item.field)).toContain('showGroundGrid')
  })

  it('每个字段要么被渲染层读过，要么在两张豁免清单里', () => {
    const dead = FIELDS.filter(
      (item) =>
        !EDITOR_ONLY.has(item.field) &&
        !KNOWN_DEAD.has(item.field) &&
        !isRead(item.field),
    ).map((item) => `${item.iface}.${item.field}`)

    expect(dead).toEqual([])
  })

  // 豁免清单本身也要守：字段删了却留着豁免，下一个同名字段就被静默放行
  it('豁免清单里的字段都还在契约里', () => {
    const names = new Set(FIELDS.map((item) => item.field))
    const stale = [...EDITOR_ONLY, ...KNOWN_DEAD.keys()].filter(
      (field) => !names.has(field),
    )

    expect(stale).toEqual([])
  })

  it('每条「画不出来」的豁免都写了原因', () => {
    for (const [field, reason] of KNOWN_DEAD) {
      expect(reason.length, `${field} 的豁免没写原因`).toBeGreaterThan(10)
    }
  })
})
