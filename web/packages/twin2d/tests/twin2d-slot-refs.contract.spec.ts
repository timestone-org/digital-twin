/**
 * @fileoverview 契约：整个预置库里的**每一处引用都指得到东西**——槽键指得到槽位、
 * sprite id 指得到内置图标、渐变 id 指得到本图元里的渐变、补丁的键指得到图元。
 *
 * ⚠ 四类悬空在渲染层是同一种表现：**什么都没发生**。槽键写错 → 那一格永远是占位符；
 * sprite id 写错 → 那一枚永远空白；渐变 id 写错 → 那一块不上色；补丁键写错 → 变体
 * 命中了但外观纹丝不动。四处全都零报错，只有这一条扫得出来。
 * ⚠ 扫描器自带自检（最后一个 describe）：断言它确实遍历到了东西、且把「已知集合抽空」
 * 时会整片报违例。少了自检，哪天汇总函数改名它就静默空转——本仓踩过这个坑。
 * ⚠ 槽键那一类直接用发货那份遍历器 `twin2dSlotRefs`，这里不再抄第二份：抄了的话，
 * 「哪些地方能写槽键」在发货侧多扫或少扫一处，这里照样扫得干干净净。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_SPRITE_IDS } from '../src/kinds'
import { TWIN_2D_EDGE_PRESETS } from '../src/presets/edges'
import { TWIN_2D_BUILTIN_NODE_STYLES } from '../src/presets/nodes'
import {
  TWIN_2D_SENSOR_DEFS,
  TWIN_2D_SENSOR_PILLS,
  twin2dSensorIdPrefix,
  twin2dSensorSlot,
} from '../src/presets/sensors'
import {
  twin2dSlotRefs,
  twin2dStyleScope,
  twin2dWalkPrims,
} from '../src/slotRefs'
import type { Twin2dSlotScope } from '../src/slotRefs'
import type { Twin2dNodeStyle } from '../src/types'
import type { Twin2dPrim, Twin2dPrimPatch } from '../src/typesPrim'

/** 四类引用。 */
type RefKind = 'slot' | 'sprite' | 'gradient' | 'patch-key'

/** 一处引用：指向什么、在哪儿、以及它本该落进的那个集合。 */
interface Ref {
  kind: RefKind
  value: string
  where: string
  allowed: ReadonlySet<string>
}

/** 一份要扫的东西：一个槽引用作用域，加上给人看的名字。 */
interface Subject {
  label: string
  scope: Twin2dSlotScope
}

/** 深度优先摊平图元树，box 连它自己带上。 */
function flatten(prims: readonly Twin2dPrim[]): Twin2dPrim[] {
  return twin2dWalkPrims(prims, '').map((site) => site.prim)
}

function refsOf(
  kind: RefKind,
  values: readonly string[],
  where: string,
  allowed: ReadonlySet<string>,
): Ref[] {
  return values.map((value) => ({ kind, value, where, allowed }))
}

/** 一枚图元引到的 sprite id。 */
function primSprites(prim: Twin2dPrim): string[] {
  return prim.kind === 'ico' && prim.src.kind === 'sprite' ? [prim.src.id] : []
}

/** 一枚 `vec` 的填充引到的局部渐变，允许集合就是它自己那份 `gradients`。 */
function primGradientRef(prim: Twin2dPrim, where: string): Ref[] {
  if (prim.kind !== 'vec' || prim.fill.kind !== 'gradient') return []
  const allowed = new Set(prim.gradients.map((one) => one.id))
  return refsOf('gradient', [prim.fill.id], where, allowed)
}

/**
 * 槽键那一类：整套「哪儿能写槽键」的遍历用发货那一份，允许集合是本作用域的槽位。
 * @param subject 要扫的作用域
 */
function slotRefsOf(subject: Subject): Ref[] {
  const allowed = new Set(subject.scope.slots.map((slot) => slot.key))
  return twin2dSlotRefs(subject.scope).map((ref) => ({
    kind: 'slot' as const,
    value: ref.key,
    where: `${subject.label} ${ref.at}`,
    allowed,
  }))
}

/** 图元树上的另外两类引用：sprite id 与局部渐变。 */
function treeRefs(subject: Subject, sprites: ReadonlySet<string>): Ref[] {
  return flatten(subject.scope.prims).flatMap((prim) => {
    const where = `${subject.label} 图元 ${prim.id}`
    return [
      ...refsOf('sprite', primSprites(prim), where, sprites),
      ...primGradientRef(prim, where),
    ]
  })
}

/** 一条补丁换上去的 sprite id（`src` 两族共用一个键）。 */
function patchSprites(patch: Twin2dPrimPatch): string[] {
  const src = patch.src
  return src !== undefined && src.kind === 'sprite' ? [src.id] : []
}

/** 补丁把填充换成渐变时，允许集合取补丁自己那份 `gradients`（没给就是原图元那份）。 */
function patchGradientRef(
  patch: Twin2dPrimPatch,
  prim: Twin2dPrim | undefined,
  where: string,
): Ref[] {
  const fill = patch.fill
  if (fill === undefined || fill.kind !== 'gradient') return []
  const own = prim !== undefined && prim.kind === 'vec' ? prim.gradients : []
  const allowed = new Set((patch.gradients ?? own).map((one) => one.id))
  return refsOf('gradient', [fill.id], where, allowed)
}

/** 一张「图元 id → 补丁」表上的另外三类引用，键本身也是一处引用。 */
function patchTableRefs(
  table: Readonly<Record<string, Twin2dPrimPatch>>,
  subject: Subject,
  sprites: ReadonlySet<string>,
): Ref[] {
  const byId = new Map(
    flatten(subject.scope.prims).map((prim) => [prim.id, prim]),
  )
  const primIds = new Set(byId.keys())
  return Object.entries(table).flatMap(([primId, patch]) => {
    const where = `${subject.label} 补丁 ${primId}`
    return [
      ...refsOf('patch-key', [primId], where, primIds),
      ...refsOf('sprite', patchSprites(patch), where, sprites),
      ...patchGradientRef(patch, byId.get(primId), where),
    ]
  })
}

/** 变体上的另外三类引用：那张补丁表。 */
function variantRefs(subject: Subject, sprites: ReadonlySet<string>): Ref[] {
  return subject.scope.variants.flatMap((variant) =>
    patchTableRefs(variant.patch, subject, sprites),
  )
}

/**
 * 一份东西上的全部引用。
 * @param subject 要扫的作用域
 * @param sprites 已知的 sprite id 集合（自检时故意传空集）
 */
function collectRefs(subject: Subject, sprites: ReadonlySet<string>): Ref[] {
  return [
    ...slotRefsOf(subject),
    ...treeRefs(subject, sprites),
    ...variantRefs(subject, sprites),
  ]
}

/** 指不到东西的那些引用。 */
function danglingIn(refs: readonly Ref[]): string[] {
  return refs
    .filter((ref) => !ref.allowed.has(ref.value))
    .map((ref) => `${ref.where}: ${ref.kind} → ${ref.value}`)
}

const KNOWN_SPRITES: ReadonlySet<string> = new Set<string>(TWIN_2D_SPRITE_IDS)

function subjectOfStyle(style: Twin2dNodeStyle): Subject {
  return { label: `样式 ${style.id}`, scope: twin2dStyleScope(style) }
}

/**
 * 预置库里的 19 个节点样式：11 种节点类型 + 8 枚电路符号。
 * ⚠ 取的是发货用的那份汇总，而不是就地按族再拼一次：拼第二份的话，汇总面哪天漏掉
 * 一整族，这里照样扫得干干净净——漏掉的那一族一处引用都不会有人查。
 */
const NODE_STYLES: readonly Twin2dNodeStyle[] = TWIN_2D_BUILTIN_NODE_STYLES

/** 4 枚传感器药丸各自成一份：一枚药丸只该引它自己那一条读数槽。 */
const SENSOR_SUBJECTS: readonly Subject[] = TWIN_2D_SENSOR_DEFS.map(
  (def): Subject => {
    const pillId = `${twin2dSensorIdPrefix(def)}-pill`
    const pill = TWIN_2D_SENSOR_PILLS.find((one) => one.id === pillId)
    if (pill === undefined) throw new Error(`没有传感器药丸 ${pillId}`)
    return {
      label: `传感器 ${def.id}`,
      scope: {
        prims: [pill],
        primsField: 'prims',
        slots: [twin2dSensorSlot(def)],
        variants: [],
        patch: {},
      },
    }
  },
)

const SUBJECTS: readonly Subject[] = [
  ...NODE_STYLES.map(subjectOfStyle),
  ...SENSOR_SUBJECTS,
]

const ALL_REFS: readonly Ref[] = SUBJECTS.flatMap((subject) =>
  collectRefs(subject, KNOWN_SPRITES),
)

function countOf(kind: RefKind): number {
  return ALL_REFS.filter((ref) => ref.kind === kind).length
}

describe('预置库零悬空', () => {
  it.each(SUBJECTS)('$label 的每一处引用都指得到东西', (subject) => {
    expect(danglingIn(collectRefs(subject, KNOWN_SPRITES))).toEqual([])
  })

  it('槽键：`txt` 来源、显示条件、变体条件与派生算式引到的都在本样式的 slots 里', () => {
    expect(danglingIn(ALL_REFS.filter((ref) => ref.kind === 'slot'))).toEqual(
      [],
    )
  })

  it('sprite id：图元与变体补丁换上去的都在 TWIN_2D_SPRITE_IDS 里', () => {
    expect(danglingIn(ALL_REFS.filter((ref) => ref.kind === 'sprite'))).toEqual(
      [],
    )
  })

  it('渐变 id：`vec` 的填充引到的都在本图元的 gradients 里', () => {
    expect(
      danglingIn(ALL_REFS.filter((ref) => ref.kind === 'gradient')),
    ).toEqual([])
  })

  it('补丁的键都指向真实存在的图元 id', () => {
    expect(
      danglingIn(ALL_REFS.filter((ref) => ref.kind === 'patch-key')),
    ).toEqual([])
  })

  it('四类合起来一条悬空都没有', () => {
    expect(danglingIn(ALL_REFS)).toEqual([])
  })
})

describe('预置连线', () => {
  it('5 条预置连线样式的 id 就是那五种能流', () => {
    expect(TWIN_2D_EDGE_PRESETS.map((edge) => edge.id)).toEqual([
      'waste-heat',
      'steam',
      'air',
      'solar',
      'water',
    ])
  })

  // 连线样式没有图元树、没有槽位、没有变体：它引不到任何东西，所以上面四类
  // 一条都轮不到它。列在这儿是为了「扫了整个预置库」这句话有据可查
  it('连线样式一处槽键/图标/渐变引用都没有，四类检查与它无关', () => {
    const fields = TWIN_2D_EDGE_PRESETS.map((edge) => Object.keys(edge).sort())
    const first = fields[0] ?? []

    expect(first).not.toContain('prims')
    expect(first).not.toContain('slots')
    expect(first).not.toContain('variants')
    expect(fields.every((keys) => keys.join() === first.join())).toBe(true)
  })
})

describe('扫描器自检', () => {
  it('确实遍历到了 19 个节点样式 + 4 枚传感器，一个都没漏', () => {
    expect(NODE_STYLES.map((style) => style.id)).toEqual([
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
      'circuit-resistor',
      'circuit-capacitor',
      'circuit-inductor',
      'circuit-diode',
      'circuit-switch',
      'circuit-ground',
      'circuit-source',
      'circuit-junction',
    ])
    expect(SUBJECTS.length).toBe(23)
  })

  it('三类引用各自都数出了不止一处——空转的扫描器也会「零悬空」', () => {
    expect(countOf('slot')).toBeGreaterThan(0)
    expect(countOf('sprite')).toBeGreaterThan(0)
    expect(countOf('patch-key')).toBeGreaterThan(0)
    expect(ALL_REFS.length).toBeGreaterThan(0)
  })

  it('把已知 sprite 集合抽空，sprite 那一类整片报违例', () => {
    const empty: ReadonlySet<string> = new Set<string>()
    const refs = SUBJECTS.flatMap((subject) => collectRefs(subject, empty))
    const sprites = refs.filter((ref) => ref.kind === 'sprite')

    expect(sprites.length).toBe(countOf('sprite'))
    expect(danglingIn(sprites).length).toBe(sprites.length)
  })

  // 改键而不是清空：清空会连派生槽自己一起摘掉，于是「槽键引用」的条数也跟着变少，
  // 那就分不清是「全报了违例」还是「压根没扫到」
  it('把槽位的键整体改名，槽键那一类整片报违例', () => {
    const stripped = SUBJECTS.map((subject) => ({
      ...subject,
      scope: {
        ...subject.scope,
        slots: subject.scope.slots.map((slot) => ({
          ...slot,
          key: `x-${slot.key}`,
        })),
      },
    }))
    const refs = stripped.flatMap((subject) =>
      collectRefs(subject, KNOWN_SPRITES),
    )
    const slots = refs.filter((ref) => ref.kind === 'slot')

    expect(slots.length).toBe(countOf('slot'))
    expect(danglingIn(slots).length).toBe(slots.length)
  })

  it('喂一份四类全悬空的假样式，四条违例一条不少地报出来', () => {
    const bad: Subject = {
      label: '假样式',
      scope: {
        primsField: 'prims',
        slots: [],
        patch: {},
        prims: [
          {
            kind: 'vec',
            id: 'body',
            coord: 'px',
            shape: { kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1 },
            fill: { kind: 'gradient', id: '没这个渐变' },
            strokes: [],
            gradients: [],
            stretch: false,
            at: { kind: 'flow' },
            size: { w: 'auto', h: 'auto' },
            minWidth: null,
            maxWidth: null,
            z: 0,
            opacity: 1,
            hidden: false,
            when: { kind: 'has', slots: ['没这个槽'], mode: 'any' },
            anim: null,
            transition: null,
            rotate: 0,
            scale: 1,
            transformOrigin: '50% 50%',
            pointerEvents: 'auto',
            keepUpright: false,
          },
        ],
        variants: [
          {
            id: 'v',
            when: {
              kind: 'slot',
              slot: '也没这个槽',
              op: 'gt',
              value: 1,
              value2: null,
            },
            patch: { 没这个图元: {} },
            rootPatch: {},
          },
        ],
      },
    }

    expect(danglingIn(collectRefs(bad, KNOWN_SPRITES)).sort()).toEqual([
      '假样式 prims[0].when.slots[0]: slot → 没这个槽',
      '假样式 variants[0].when.slot: slot → 也没这个槽',
      '假样式 图元 body: gradient → 没这个渐变',
      '假样式 补丁 没这个图元: patch-key → 没这个图元',
    ])
  })
})
