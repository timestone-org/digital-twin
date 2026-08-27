/**
 * @fileoverview 契约：2D 孪生文档契约里的每个字段，右栏检查器上都有地方改。
 *
 * ⚠ 给 `Twin2dNode` 一类加一个字段、却忘了在检查器上开一个控件，是完全静默的失败：
 * 归一化给它一个缺省值，渲染层照常读，用户只能去改 JSON，或者根本不知道有这么个
 * 东西。本轮就逮到一例——角标那三项（`badge` / `badgeColor` / `badgeShape`）画得
 * 出来、变体也读它，面板上却一个入口都没有。
 *
 * ⚠ 判据是「检查器源码里出现过 `node.badge` 这样的**取值**写法」：光有字段名太松
 * （`x` 谁都能撞上），要求取值写法就把「检查器读了当前实体的这一格」钉住了。它挡的
 * 是「整个漏掉」，不是「接错」——接错由各检查器自己的用例守。
 *
 * ⚠ 字段名从**归一化产出的对象**上取，不从类型文本里抠：类型改了形状（换成
 * 交叉类型、拆成两个接口）正则会静默扫出空表，而扫出空表的扫描器永远是绿的。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const INSPECTOR_DIR = join(
  process.cwd(),
  'app',
  'src',
  'pages',
  'Twin2dEditor',
  'components',
)

/** 四类实体的字段总数下限：类型塌成空对象时扫描器会静默空转，这道拦住它。 */
const MIN_FIELDS = 55

/** 一个检查器里读当前实体的次数下限；改了 prop 名会先在这里红，好过报成整片缺失。 */
const MIN_READS = 5

/**
 * 不给人手改的字段，逐条写明为什么。
 * ⚠ 往这里加之前先问一句「用户改不到它，会不会因此配不出某种效果」——会就不是豁免，
 * 是缺陷。清单本身也被守着：字段改了名，下面那条用例会把这里的陈条报出来。
 */
const NOT_EDITABLE: ReadonlyMap<string, string> = new Map([
  [
    'id',
    'id 是实体的身份：连线的两端、绑定行的行号、图元覆盖的键全按它对上，' +
      '手改一个等于把这些一起指到空处，而每一处都是静默失效',
  ],
])

/** 一类实体：字段从哪儿来、谁负责让人改、检查器里管它叫什么。 */
interface Owner {
  /** 检查器里读当前实体用的那个名字（`node.badge` 里的 `node`）。 */
  root: string
  /** 这一类的字段名，取自归一化产出。 */
  fields: readonly string[]
  /** 负责让人改这一类的文件，相对 `components/`。 */
  files: readonly string[]
}

/** 一份含齐四类实体的样例配置；键集合从它身上取。 */
const SAMPLE = normalizeTwin2dConfig({
  nodes: [{ id: 'n' }],
  edges: [{ id: 'e', from: { nodeId: 'n' }, to: { nodeId: 'n' } }],
  marks: [{ id: 'm', kind: 'rect' }],
})

/**
 * 样例实体的字段名；一条都没造出来就当场炸，不让扫描器空转下去。
 * @param row 样例实体
 * @param what 这是哪一类，报错时说得出名字
 */
function keysOf(row: object | undefined, what: string): readonly string[] {
  if (row === undefined) throw new Error(`${what} 的样例没造出来`)
  return Object.keys(row)
}

const OWNERS: Readonly<Record<string, Owner>> = {
  画布: {
    root: 'canvas',
    fields: keysOf(SAMPLE.canvas, '画布'),
    files: ['inspector/CanvasInspector.vue'],
  },
  节点: {
    root: 'node',
    fields: keysOf(SAMPLE.nodes[0], '节点'),
    files: [
      'inspector/NodeInspector.vue',
      'inspector/NodeBadgeFields.vue',
      'inspector/NodeTagList.vue',
      'inspector/NodePortList.vue',
      'inspector/NodeSensorList.vue',
      'inspector/NodeLayerList.vue',
    ],
  },
  连线: {
    root: 'edge',
    fields: keysOf(SAMPLE.edges[0], '连线'),
    files: ['inspector/EdgeInspector.vue'],
  },
  标注: {
    root: 'mark',
    fields: keysOf(SAMPLE.marks[0], '标注'),
    files: ['inspector/MarkInspector.vue'],
  },
}

/** 去掉注释：注释里提到一个字段名不等于给了它一个控件。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
}

/**
 * 一类实体的负责文件拼成的源码。
 * @param owner 这一类
 */
function sourceOf(owner: Owner): string {
  return owner.files
    .map((rel) => stripComments(readFileSync(join(INSPECTOR_DIR, rel), 'utf8')))
    .join('\n')
}

const SOURCES = new Map(
  Object.entries(OWNERS).map(([name, owner]) => [name, sourceOf(owner)]),
)

/**
 * 这一类的源码里读过这一格没有。
 * @param name 这一类
 * @param owner 这一类
 * @param field 字段名
 */
function isEditable(name: string, owner: Owner, field: string): boolean {
  const source = SOURCES.get(name) ?? ''
  return new RegExp(`\\b${owner.root}\\.${field}\\b`).test(source)
}

const ENTRIES = Object.entries(OWNERS)
const ALL_FIELDS = ENTRIES.flatMap(([, owner]) => owner.fields)

describe('检查器覆盖了整份 2D 孪生契约', () => {
  it('四类实体的字段都抽得出来，别让扫描器悄悄空转', () => {
    expect(ALL_FIELDS.length).toBeGreaterThan(MIN_FIELDS)
    // 角标那三项是本轮补上的缺口，钉住它们防的是「改回去也没人发现」
    expect(OWNERS.节点?.fields).toContain('badgeShape')
    expect(OWNERS.标注?.fields).toContain('nonScalingStroke')
  })

  it.each(ENTRIES)('%s 的检查器读的是当前那一条', (name, owner) => {
    const reads = SOURCES.get(name)?.match(
      new RegExp(`\\b${owner.root}\\.\\w`, 'g'),
    )
    expect(reads?.length ?? 0).toBeGreaterThan(MIN_READS)
  })

  it.each(ENTRIES)('%s 的每个字段都能改', (name, owner) => {
    const missing = owner.fields.filter(
      (field) => !NOT_EDITABLE.has(field) && !isEditable(name, owner, field),
    )

    expect(missing).toEqual([])
  })

  // 字段改了名却留着豁免，下一个同名字段就被静默放行
  it('豁免清单里的字段都还在契约里', () => {
    const known = new Set(ALL_FIELDS)
    const stale = [...NOT_EDITABLE.keys()].filter((field) => !known.has(field))

    expect(stale).toEqual([])
  })

  it('每条豁免都写了理由', () => {
    for (const [field, reason] of NOT_EDITABLE) {
      expect(reason.length, `${field} 的豁免没写理由`).toBeGreaterThan(20)
    }
  })
})
