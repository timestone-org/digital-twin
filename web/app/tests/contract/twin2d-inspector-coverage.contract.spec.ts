/**
 * @fileoverview 契约：2D 孪生文档契约里的每个字段，右栏检查器上都有地方改。
 *
 * ⚠ 给 `Twin2dNode` 一类加一个字段、却忘了在检查器上开一个控件，是完全静默的失败：
 * 归一化给它一个缺省值，渲染层照常读，用户只能去改 JSON，或者根本不知道有这么个
 * 东西。第一轮就逮到一例——角标那三项（`badge` / `badgeColor` / `badgeShape`）画得
 * 出来、变体也读它，面板上却一个入口都没有。
 *
 * ⚠ 判据是「负责它的源码里出现过 `node.badge` 这样的**取值**写法」：光有字段名太松
 * （`x` 谁都能撞上），要求取值写法就把「检查器读了当前那一条」钉住了。它挡的是
 * 「整个漏掉」，不是「接错」——接错由各检查器自己的用例守。
 *
 * ⚠ 字段名从**归一化产出的对象**上取，不从类型文本里抠：类型改了形状（换成
 * 交叉类型、拆成两个接口）正则会静默扫出空表，而扫出空表的扫描器永远是绿的。
 *
 * ⚠ 两组：实体那一组（画布 / 节点 / 连线 / 标注）与**样式**那一组（两类样式、端口、
 * 槽位、变体与四种图元）。少了后一组，样式里那几十个字段仍然只能改 JSON，而这道
 * 契约照常报绿——样式面是后接上的，正是最容易漏字段的地方。
 */
import {
  normalizeEdgeStyles,
  normalizeNodeStyles,
  normalizePrims,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dPrimKind } from '@dt/twin2d'
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

/** 两组加起来的字段总数下限：类型塌成空对象时扫描器会静默空转，这道拦住它。 */
const MIN_FIELDS = 140

/** 一个负责面里读当前那一条的次数下限；改了 prop 名会先在这里红。 */
const MIN_READS = 5

/**
 * 谁都不给人手改的那一个，写明为什么。
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

/** 只在图元那四类上豁免的两项。 */
const PRIM_EXEMPT: ReadonlyMap<string, string> = new Map([
  [
    'kind',
    '换 kind 等于把渲染分支整条换掉，已经配好的那些格子一个都留不住；要换只能' +
      '删了重加。摆一个「换类型」下拉会让人以为原地换过去还留得住那些格子',
  ],
  [
    'children',
    '盒的子树在图元树上增删改（PrimTree + primOps）：那里要拦深度与成环，' +
      '在字段面里再开一个入口就是第二处判断，而漏掉的那一处会在存盘时静默截断',
  ],
])

/** 一类字段：字段从哪儿来、谁负责让人改、负责面里管它叫什么。 */
interface Owner {
  /** 负责面里读当前那一条用的那个名字（`node.badge` 里的 `node`）。 */
  root: string
  /** 这一类的字段名，取自归一化产出。 */
  fields: readonly string[]
  /** 负责让人改这一类的文件，相对 `components/`。 */
  files: readonly string[]
  /** 只在这一类上成立的豁免。 */
  exempt?: ReadonlyMap<string, string>
  /** 这一面读当前那一条的次数下限；不给就按 `MIN_READS`。 */
  minReads?: number
}

/** 一份含齐四类实体的样例配置；键集合从它身上取。 */
const SAMPLE = normalizeTwin2dConfig({
  nodes: [{ id: 'n' }],
  edges: [{ id: 'e', from: { nodeId: 'n' }, to: { nodeId: 'n' } }],
  marks: [{ id: 'm', kind: 'rect' }],
})

/** 一份含齐端口、槽位与变体的样例节点样式。 */
const NODE_STYLE = normalizeNodeStyles([
  {
    id: 's',
    ports: [{ id: 'p' }],
    slots: [{ key: 'k' }],
    variants: [{ id: 'v', when: { kind: 'status', in: ['alarm'] } }],
  },
])[0]

const EDGE_STYLE = normalizeEdgeStyles([{ id: 'es' }])[0]

/** 四种图元各一枚；基类那十几项在每一枚上都在。 */
const PRIMS = normalizePrims(
  (
    ['box', 'vec', 'ico', 'txt'] as const satisfies readonly Twin2dPrimKind[]
  ).map((kind) => ({ id: kind, kind })),
  0,
)

/**
 * 样例条目的字段名；一条都没造出来就当场炸，不让扫描器空转下去。
 * @param row 样例条目
 * @param what 这是哪一类，报错时说得出名字
 */
function keysOf(row: object | undefined, what: string): readonly string[] {
  if (row === undefined) throw new Error(`${what} 的样例没造出来`)
  return Object.keys(row)
}

/**
 * 一枚图元的字段名。
 * @param kind 哪一种图元
 */
function primKeys(kind: Twin2dPrimKind): readonly string[] {
  return keysOf(
    PRIMS.find((prim) => prim.kind === kind),
    `${kind} 图元`,
  )
}

/**
 * 一种图元的那一份 Owner；四种共用基类面，各自再加一份分档面。
 * @param kind 哪一种图元
 * @param file 这一档自己的字段面，相对 `components/`
 */
function primOwner(kind: Twin2dPrimKind, file: string): Owner {
  return {
    root: 'modelValue',
    fields: primKeys(kind),
    files: [file, 'inspector/prim/PrimBaseFields.vue'],
    exempt: PRIM_EXEMPT,
  }
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
  节点样式: {
    root: 'nodeStyle',
    fields: keysOf(NODE_STYLE, '节点样式'),
    files: ['inspector/StyleInspector.vue', 'inspector/StylePane.vue'],
  },
  连线样式: {
    root: 'edgeStyle',
    fields: keysOf(EDGE_STYLE, '连线样式'),
    files: ['inspector/EdgeStyleInspector.vue'],
  },
  端口: {
    root: 'port',
    fields: keysOf(NODE_STYLE?.ports[0], '端口'),
    files: ['fields/PortList.vue'],
  },
  槽位: {
    root: 'slot',
    fields: keysOf(NODE_STYLE?.slots[0], '槽位'),
    files: ['fields/SlotList.vue'],
  },
  变体: {
    root: 'modelValue',
    fields: keysOf(NODE_STYLE?.variants[0], '变体'),
    files: ['inspector/VariantFields.vue'],
    // 变体只有三格能改（id 是身份），下界跟着收到 2
    minReads: 2,
  },
  盒图元: primOwner('box', 'inspector/prim/BoxFields.vue'),
  矢量图元: primOwner('vec', 'inspector/prim/VecFields.vue'),
  图标图元: primOwner('ico', 'inspector/prim/IcoFields.vue'),
  文本图元: primOwner('txt', 'inspector/prim/TxtFields.vue'),
}

/** 去掉注释：注释里提到一个字段名不等于给了它一个控件。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
}

/**
 * 一类字段的负责文件拼成的源码。
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

/**
 * 这一格豁不豁免；全局那一条与这一类自己那几条都算。
 * @param owner 这一类
 * @param field 字段名
 */
function isExempt(owner: Owner, field: string): boolean {
  return NOT_EDITABLE.has(field) || owner.exempt?.has(field) === true
}

const ENTRIES = Object.entries(OWNERS)
const ALL_FIELDS = ENTRIES.flatMap(([, owner]) => owner.fields)

describe('检查器覆盖了整份 2D 孪生契约', () => {
  it('两组的字段都抽得出来，别让扫描器悄悄空转', () => {
    expect(ALL_FIELDS.length).toBeGreaterThan(MIN_FIELDS)
    // 角标那三项是第一轮补上的缺口，钉住它们防的是「改回去也没发现」
    expect(OWNERS.节点?.fields).toContain('badgeShape')
    expect(OWNERS.标注?.fields).toContain('nonScalingStroke')
    // 样式那一组的四棵子表：抽空了的话下面每一条都会轻松通过
    expect(OWNERS.节点样式?.fields).toContain('prims')
    expect(OWNERS.连线样式?.fields).toContain('startMarker')
    expect(OWNERS.端口?.fields).toContain('marker')
    expect(OWNERS.槽位?.fields).toContain('enumMap')
  })

  it.each(ENTRIES)('%s 的字段面读的是当前那一条', (name, owner) => {
    const reads = SOURCES.get(name)?.match(
      new RegExp(`\\b${owner.root}\\.\\w`, 'g'),
    )
    expect(reads?.length ?? 0).toBeGreaterThan(owner.minReads ?? MIN_READS)
  })

  it.each(ENTRIES)('%s 的每个字段都能改', (name, owner) => {
    const missing = owner.fields.filter(
      (field) => !isExempt(owner, field) && !isEditable(name, owner, field),
    )

    expect(missing).toEqual([])
  })

  // 字段改了名却留着豁免，下一个同名字段就被静默放行
  it('全局豁免里的字段都还在契约里', () => {
    const known = new Set(ALL_FIELDS)
    const stale = [...NOT_EDITABLE.keys()].filter((field) => !known.has(field))

    expect(stale).toEqual([])
  })

  // 图元那两条豁免必须真落在图元的字段上，否则它们会悄悄放行别的东西
  it('图元豁免里的字段都还在图元契约里', () => {
    const known = new Set(primKeys('box'))
    const stale = [...PRIM_EXEMPT.keys()].filter((field) => !known.has(field))

    expect(stale).toEqual([])
  })

  it('每条豁免都写了理由', () => {
    for (const [field, reason] of [...NOT_EDITABLE, ...PRIM_EXEMPT]) {
      expect(reason.length, `${field} 的豁免没写理由`).toBeGreaterThan(20)
    }
  })
})
