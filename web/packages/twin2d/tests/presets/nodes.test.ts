/**
 * @fileoverview 锁住预置节点样式的汇总面：19 条的身份与文档序、id → 样式那张查表与
 * 清单是同一批对象，以及「源与末端两族进的是**带子类变体**的那一份」。
 *
 * ⚠ 汇总面接错了族在渲染层是彻底静默的：节点照样画得出来，只是 25 种子类组合一条
 * 都不生效；id 漏一个也只是调色板里少一件。两样都没有一处会报错，只有这里扫得出来。
 *
 * 末尾两组守的是图元 id 词表：四族共用一套名字、每条变体补丁的键都指得到一枚图元，
 * 以及 `frame` 这个**角色名**——十一种节点样式里承载边框 / 圆角 / 选中态的那一枚一律
 * 叫它，与它是 `box` 还是 `vec` 无关。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_CIRCUIT_STYLES } from '../../src/presets/circuit'
import {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
} from '../../src/presets/nodes'
import { TWIN_2D_MISC_STYLES } from '../../src/presets/nodesMisc'
import { TWIN_2D_SOURCE_STYLES } from '../../src/presets/nodesSource'
import { TWIN_2D_TERMINAL_STYLES } from '../../src/presets/nodesTerminal'
import { TWIN_2D_VESSEL_STYLES } from '../../src/presets/nodesVessel'
import {
  TWIN_2D_SOURCE_SUBTYPE_DEFS,
  TWIN_2D_SUBTYPED_SOURCE_STYLES,
  TWIN_2D_SUBTYPED_TERMINAL_STYLES,
  TWIN_2D_SUBTYPE_TAG_KEY,
  TWIN_2D_TERMINAL_SUBTYPE_DEFS,
} from '../../src/presets/subtypes'
import type { Twin2dNodeStyle } from '../../src/types'
import type { Twin2dPrim } from '../../src/typesPrim'

/** 参考项目 `BUILTIN_NODE_TYPES` 的 11 条，逐位同序。 */
const REFERENCE_TYPE_IDS = [
  'waste-heat-source',
  'steam-source',
  'air-source',
  'solar-source',
  'water-tank',
  'manifold',
  'bath-terminal',
  'heating-terminal',
  'ac-terminal',
  'heat-exchanger',
  'label',
] as const

/** 8 枚电路符号，接在 11 种节点类型之后。 */
const CIRCUIT_IDS = [
  'circuit-resistor',
  'circuit-capacitor',
  'circuit-inductor',
  'circuit-diode',
  'circuit-switch',
  'circuit-ground',
  'circuit-source',
  'circuit-junction',
] as const

function idsOf(styles: readonly Twin2dNodeStyle[]): string[] {
  return styles.map((style) => style.id)
}

function flatPrims(prims: readonly Twin2dPrim[]): Twin2dPrim[] {
  const out: Twin2dPrim[] = []
  for (const prim of prims) {
    out.push(prim)
    if (prim.kind === 'box') out.push(...flatPrims(prim.children))
  }
  return out
}

function primIdsOf(style: Twin2dNodeStyle): string[] {
  return flatPrims(style.prims).map((prim) => prim.id)
}

/** 源 / 容器 / 末端 / 杂项四族，电路符号那一族的图元词表另成一套。 */
const FOUR_FAMILY_STYLES: readonly Twin2dNodeStyle[] = [
  ...TWIN_2D_SOURCE_STYLES,
  ...TWIN_2D_VESSEL_STYLES,
  ...TWIN_2D_TERMINAL_STYLES,
  ...TWIN_2D_MISC_STYLES,
]

/** 四族共用的那套图元 id，全在这张表里各司其名。 */
const SHARED_PRIM_IDS = [
  'body',
  'frame',
  'glyph',
  'icon',
  'label-natural',
  'status-dot',
] as const

/** 这四个同义词一族都不许出现：留一个在库里，抄过去的补丁就寻不到址。 */
const FORBIDDEN_PRIM_ID_SYNONYMS = [
  'dot',
  'icon-glyph',
  'outline',
  'tile',
] as const

/** 十一种节点类型，电路符号那八枚的图元词表另成一套。 */
const NODE_TYPE_STYLES = TWIN_2D_BUILTIN_NODE_STYLES.slice(0, 11)

/** 承载边框 / 圆角 / 选中态的那一枚图元的 id。 */
const FRAME_PRIM_ID = 'frame'

/** 每份样式都挂着的两枚外挂件，自带药丸圆角，扫「谁承载观感」时先摘掉。 */
const ATTACHED_PRIM_IDS = new Set(['status-dot', 'badge'])

/** 十一种里唯一无边框无底色的一件：它那枚 `frame` 只剩「最外层」这一个角色（§7.6）。 */
const CHROMELESS_STYLE_ID = 'label'

// 边框 / 圆角 / 描边——三样占一样就算承载观感
function carriesChrome(prim: Twin2dPrim): boolean {
  if (prim.kind === 'box') return prim.border.width > 0 || prim.radius !== 0
  if (prim.kind === 'vec') return prim.strokes.length > 0
  return false
}

// 文档序即绘制序，深度优先就是从外往里：头一枚承载观感的就是这份样式的可见面
function chromeCarrierOf(style: Twin2dNodeStyle): Twin2dPrim | undefined {
  return flatPrims(style.prims).find(
    (prim) => !ATTACHED_PRIM_IDS.has(prim.id) && carriesChrome(prim),
  )
}

describe('预置节点样式的清单', () => {
  it('19 条：11 种节点类型接 8 枚电路符号', () => {
    expect(idsOf(TWIN_2D_BUILTIN_NODE_STYLES)).toEqual([
      ...REFERENCE_TYPE_IDS,
      ...CIRCUIT_IDS,
    ])
  })

  it('前 11 条的文档序与参考项目的内置类型表逐位一致', () => {
    expect(idsOf(TWIN_2D_BUILTIN_NODE_STYLES).slice(0, 11)).toEqual([
      ...REFERENCE_TYPE_IDS,
    ])
  })

  it('id 两两不同——重名会让后一条在查表里静默盖掉前一条', () => {
    const ids = idsOf(TWIN_2D_BUILTIN_NODE_STYLES)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('五个族一件不落，且各族内部保持本族的文档序', () => {
    const ids = idsOf(TWIN_2D_BUILTIN_NODE_STYLES)
    const families = [
      idsOf(TWIN_2D_SOURCE_STYLES),
      idsOf(TWIN_2D_VESSEL_STYLES),
      idsOf(TWIN_2D_TERMINAL_STYLES),
      idsOf(TWIN_2D_MISC_STYLES),
      idsOf(TWIN_2D_CIRCUIT_STYLES),
    ]

    expect(families.flat()).toEqual(ids)
  })

  it('每一条都过得了「样式必备的十项」这道形状检查', () => {
    for (const style of TWIN_2D_BUILTIN_NODE_STYLES) {
      expect(Object.keys(style).sort()).toEqual([
        'accent',
        'category',
        'defaultStatus',
        'id',
        'name',
        'outline',
        'ports',
        'prims',
        'size',
        'slots',
        'variants',
      ])
    }
  })
})

describe('id → 样式的查表', () => {
  it('条数与清单一样，一条不多一条不少', () => {
    expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.size).toBe(
      TWIN_2D_BUILTIN_NODE_STYLES.length,
    )
  })

  it('每个 id 取到的就是清单里的那一份，不是复制品', () => {
    for (const style of TWIN_2D_BUILTIN_NODE_STYLES) {
      expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(style.id)).toBe(style)
    }
  })

  it('查表的键集合就是那 19 个 id', () => {
    expect([...TWIN_2D_BUILTIN_NODE_STYLE_MAP.keys()]).toEqual(
      idsOf(TWIN_2D_BUILTIN_NODE_STYLES),
    )
  })

  it('没登记的 id 取到 undefined，不给兜底样式', () => {
    expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.get('no-such-style')).toBeUndefined()
  })
})

describe('进汇总的是带子类变体的那一份', () => {
  it('四个源类样式逐个取自 TWIN_2D_SUBTYPED_SOURCE_STYLES', () => {
    for (const [index, style] of TWIN_2D_SUBTYPED_SOURCE_STYLES.entries()) {
      expect(TWIN_2D_BUILTIN_NODE_STYLES[index]).toBe(style)
    }
  })

  it('三个末端样式逐个取自 TWIN_2D_SUBTYPED_TERMINAL_STYLES', () => {
    for (const [index, style] of TWIN_2D_SUBTYPED_TERMINAL_STYLES.entries()) {
      expect(TWIN_2D_BUILTIN_NODE_STYLES[6 + index]).toBe(style)
    }
  })

  it('四个源类各带 4 条子类变体，排在交互态之前；三条名位变体排在最后', () => {
    for (const id of REFERENCE_TYPE_IDS.slice(0, 4)) {
      const style = TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(id)

      expect(style?.variants.slice(0, 4).map((one) => one.id)).toEqual(
        TWIN_2D_SOURCE_SUBTYPE_DEFS.map((def) => `subtype-${def.id}`),
      )
      expect(style?.variants.slice(4).map((one) => one.id)).toEqual([
        'hover',
        'selected',
        'alarm',
        'label-left',
        'label-right',
        'label-inside',
      ])
    }
  })

  it('三个末端各带 3 条子类变体，排在交互态之前；三条名位变体排在最后', () => {
    for (const id of REFERENCE_TYPE_IDS.slice(6, 9)) {
      const style = TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(id)

      expect(style?.variants.slice(0, 3).map((one) => one.id)).toEqual(
        TWIN_2D_TERMINAL_SUBTYPE_DEFS.map((def) => `subtype-${def.id}`),
      )
      expect(style?.variants.slice(3).map((one) => one.id)).toEqual([
        'hover',
        'selected',
        'alarm',
        'label-left',
        'label-right',
        'label-inside',
      ])
    }
  })

  it('25 条子类变体全部认 tags.subtype 这一个键', () => {
    const conditions = TWIN_2D_BUILTIN_NODE_STYLES.flatMap((style) =>
      style.variants
        .filter((one) => one.id.startsWith('subtype-'))
        .map((one) => one.when),
    )

    expect(conditions.length).toBe(25)
    for (const when of conditions) {
      expect(when.kind).toBe('tag')
      expect(when.kind === 'tag' ? when.key : '').toBe(TWIN_2D_SUBTYPE_TAG_KEY)
    }
  })

  it('容器、换热与标注、电路四族原样进来，一条子类变体都不带', () => {
    const untouched = [
      ...TWIN_2D_VESSEL_STYLES,
      ...TWIN_2D_MISC_STYLES,
      ...TWIN_2D_CIRCUIT_STYLES,
    ]

    for (const style of untouched) {
      expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(style.id)).toBe(style)
      expect(
        style.variants.filter((one) => one.id.startsWith('subtype-')),
      ).toEqual([])
    }
  })
})

/**
 * ⚠ 图元 id 是节点级 patch 与变体补丁的**寻址键**。一族给同一件东西另起一个名字，
 * 用户把一条补丁从这一族抄到那一族就指不到东西——表现是「变体命中了、外观纹丝不动」，
 * 而渲染层不会有任何一处报错。
 */
describe('四族共用同一套图元 id 词表', () => {
  it('两个同义词一族都不许出现：状态点只叫 status-dot、图标 sprite 只叫 glyph', () => {
    for (const style of FOUR_FAMILY_STYLES) {
      const ids = primIdsOf(style)

      for (const banned of FORBIDDEN_PRIM_ID_SYNONYMS) {
        expect(ids).not.toContain(banned)
      }
    }
  })

  it('十个样式各带一枚 status-dot，`hidden` 那一档也带着（摘不摘由 when 决定）', () => {
    for (const style of FOUR_FAMILY_STYLES) {
      expect(primIdsOf(style).filter((id) => id === 'status-dot')).toEqual([
        'status-dot',
      ])
    }
  })

  it('每一枚 sprite 图元不是 icon 就是 glyph，没有第三个叫法', () => {
    const sprites = FOUR_FAMILY_STYLES.flatMap((style) =>
      flatPrims(style.prims).filter((prim) => prim.kind === 'ico'),
    )

    expect(sprites.length).toBeGreaterThan(0)
    for (const prim of sprites) {
      expect(['icon', 'glyph']).toContain(prim.id)
    }
  })

  it('四族共用的那六个名字，每一个都真有样式在用', () => {
    const all = new Set(FOUR_FAMILY_STYLES.flatMap(primIdsOf))

    for (const id of SHARED_PRIM_IDS) expect(all.has(id)).toBe(true)
  })

  it('十九个样式的每一条变体补丁都指得到本样式里的一枚图元', () => {
    for (const style of TWIN_2D_BUILTIN_NODE_STYLES) {
      const ids = new Set(primIdsOf(style))

      for (const variant of style.variants) {
        for (const key of Object.keys(variant.patch)) {
          expect([style.id, key, ids.has(key)]).toEqual([style.id, key, true])
        }
      }
    }
  })
})

/**
 * ⚠ `frame` 是**角色名不是形状名**：末端 / 容器 / 源三族是有圆角的 `box`，分集水器是
 * 一枚 `vec` 画的圆柱体身，换热器是套在纯居中壳里的方砖——三种形状天差地别，但补丁
 * 要能互相抄，键就只能是同一个。按形状各起各的名字（`outline` / `tile`）时，抄过去的
 * 「选中」补丁落在一个不存在的 id 上，表现是「变体命中了、外观纹丝不动」。
 */
describe('frame 是承载边框 / 圆角 / 选中态的那一枚', () => {
  it('十一种节点样式各带一枚 frame，一枚不多一枚不少', () => {
    for (const style of NODE_TYPE_STYLES) {
      const frames = primIdsOf(style).filter((id) => id === FRAME_PRIM_ID)

      expect([style.id, frames]).toEqual([style.id, [FRAME_PRIM_ID]])
    }
  })

  it('边框 / 圆角 / 描边这三样，每一种样式里都由 frame 那一枚扛着', () => {
    for (const style of NODE_TYPE_STYLES) {
      const carrier = chromeCarrierOf(style)
      const want = style.id === CHROMELESS_STYLE_ID ? null : FRAME_PRIM_ID

      expect([style.id, carrier?.id ?? null]).toEqual([style.id, want])
    }
  })

  it('带选中态的那十种，选中补丁只落在 frame 上', () => {
    const selected = NODE_TYPE_STYLES.map((style) => ({
      id: style.id,
      variant: style.variants.find((one) => one.id === 'selected'),
    })).filter((entry) => entry.variant !== undefined)

    expect(selected.length).toBe(10)
    for (const entry of selected) {
      const keys = Object.keys(entry.variant?.patch ?? {})

      expect([entry.id, keys]).toEqual([entry.id, [FRAME_PRIM_ID]])
    }
  })

  it('换热器那枚只做居中的壳叫 shell，它一格观感都不承载', () => {
    const style = TWIN_2D_BUILTIN_NODE_STYLE_MAP.get('heat-exchanger')
    const shell = style?.prims[0]

    expect(shell?.id).toBe('shell')
    expect(shell === undefined ? true : carriesChrome(shell)).toBe(false)
    expect(
      shell?.kind === 'box' ? shell.children.map((prim) => prim.id) : [],
    ).toEqual([FRAME_PRIM_ID])
  })
})
