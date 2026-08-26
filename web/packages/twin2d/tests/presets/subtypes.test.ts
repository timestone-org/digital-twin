/**
 * @fileoverview 锁住 25 种子类视觉组合：4 源类 × 4 源子类 + 3 末端类 × 3 末端子类，
 * 逐条按「打上 `tags.subtype` 之后图标换成哪一枚、强调色变成什么」断言。
 *
 * ⚠ 这一份是「预置库是数据、不是渲染分支」在子类那一层的机械证明：25 条断言全部
 * 走 `applyVariants` 这条公共路径，没有一条读样式 id。哪天有人把子类挪进渲染件里的
 * `if (styleId === …)`，那 18 条真换图标的组合会整片红——而那个退化过程本身
 * 不会有任何一步报错。
 * ⚠ 另两组守的是「tag 不做白名单」与「文档序在后的赢」：前者塌了，子类就重新变回
 * 枚举、这一档白加；后者反了，就是「配了两条变体，其中一条永远不生效」。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_SPRITE_IDS } from '../../src/kinds'
import { normalizeCondition } from '../../src/normalizeExprs'
import { normalizeTags } from '../../src/normalizeNodes'
import { normalizeVariant } from '../../src/normalizeStyles'
import { TWIN_2D_SOURCE_STYLES } from '../../src/presets/nodesSource'
import { TWIN_2D_TERMINAL_STYLES } from '../../src/presets/nodesTerminal'
import {
  TWIN_2D_SOURCE_GLYPH_PRIM_ID,
  TWIN_2D_SOURCE_SUBTYPE_DEFS,
  TWIN_2D_SUBTYPED_SOURCE_STYLES,
  TWIN_2D_SUBTYPED_TERMINAL_STYLES,
  TWIN_2D_SUBTYPE_TAG_KEY,
  TWIN_2D_TERMINAL_GLYPH_PRIM_ID,
  TWIN_2D_TERMINAL_SUBTYPE_DEFS,
  twin2dSubtypeVariant,
  twin2dWithSubtypes,
} from '../../src/presets/subtypes'
import { applyVariants } from '../../src/variants'
import type { Twin2dNodeStyle, Twin2dVariant } from '../../src/types'
import type { Twin2dPrim } from '../../src/typesPrim'
import type { Twin2dSubtypeDef } from '../../src/presets/subtypes'
import type { Twin2dVariantCtx } from '../../src/variants'

function walk(prims: readonly Twin2dPrim[], id: string): Twin2dPrim | null {
  for (const prim of prims) {
    if (prim.id === id) return prim
    if (prim.kind === 'box') {
      const hit = walk(prim.children, id)
      if (hit !== null) return hit
    }
  }
  return null
}

/** 取一枚 ico 图元当前挂的 sprite id；不是 sprite 就当场抛，别让断言比到 undefined。 */
function spriteAt(prims: readonly Twin2dPrim[], primId: string): string {
  const prim = walk(prims, primId)
  if (prim === null) throw new Error(`图元树里没有 ${primId}`)
  if (prim.kind !== 'ico') throw new Error(`${primId} 不是 ico`)
  if (prim.src.kind !== 'sprite') throw new Error(`${primId} 挂的不是 sprite`)
  return prim.src.id
}

/** 只打了一个 tag、其余全空的求值上下文。 */
function tagCtx(value: string): Twin2dVariantCtx {
  return {
    states: new Set(),
    status: null,
    tags: new Map([[TWIN_2D_SUBTYPE_TAG_KEY, value]]),
    slots: new Map(),
    fields: new Map(),
  }
}

/** 什么都没打的求值上下文，用来取「不加子类时长什么样」。 */
function bareCtx(): Twin2dVariantCtx {
  return {
    states: new Set(),
    status: null,
    tags: new Map(),
    slots: new Map(),
    fields: new Map(),
  }
}

function styleOf(
  styles: readonly Twin2dNodeStyle[],
  id: string,
): Twin2dNodeStyle {
  const hit = styles.find((style) => style.id === id)
  if (hit === undefined) throw new Error(`没有预置样式 ${id}`)
  return hit
}

/** 一个带子类变体的样式，连同它那枚图标图元的 id 与类型自带的那枚 sprite。 */
interface Subject {
  styleId: string
  style: Twin2dNodeStyle
  glyphPrimId: string
  baseSprite: string
}

function subjectsOf(
  subtyped: readonly Twin2dNodeStyle[],
  raw: readonly Twin2dNodeStyle[],
  glyphPrimId: string,
): Subject[] {
  return subtyped.map((style) => ({
    styleId: style.id,
    style,
    glyphPrimId,
    baseSprite: spriteAt(styleOf(raw, style.id).prims, glyphPrimId),
  }))
}

const SOURCE_SUBJECTS = subjectsOf(
  TWIN_2D_SUBTYPED_SOURCE_STYLES,
  TWIN_2D_SOURCE_STYLES,
  TWIN_2D_SOURCE_GLYPH_PRIM_ID,
)
const TERMINAL_SUBJECTS = subjectsOf(
  TWIN_2D_SUBTYPED_TERMINAL_STYLES,
  TWIN_2D_TERMINAL_STYLES,
  TWIN_2D_TERMINAL_GLYPH_PRIM_ID,
)
const ALL_SUBJECTS = [...SOURCE_SUBJECTS, ...TERMINAL_SUBJECTS]

/** 一条组合：哪个样式打上哪个子类。 */
interface Combo extends Subject {
  subtypeId: string
  def: Twin2dSubtypeDef
}

function combosOf(
  subjects: readonly Subject[],
  defs: readonly Twin2dSubtypeDef[],
): Combo[] {
  return subjects.flatMap((subject) =>
    defs.map((def) => ({ ...subject, subtypeId: def.id, def })),
  )
}

const SOURCE_COMBOS = combosOf(SOURCE_SUBJECTS, TWIN_2D_SOURCE_SUBTYPE_DEFS)
const TERMINAL_COMBOS = combosOf(
  TERMINAL_SUBJECTS,
  TWIN_2D_TERMINAL_SUBTYPE_DEFS,
)
const ALL_COMBOS = [...SOURCE_COMBOS, ...TERMINAL_COMBOS]

describe('子类那一层的规模', () => {
  it('4 源类 × 4 源子类 = 16、3 末端类 × 3 末端子类 = 9，合计 25 种组合', () => {
    expect([SOURCE_COMBOS.length, TERMINAL_COMBOS.length]).toEqual([16, 9])
    expect(ALL_COMBOS.length).toBe(25)
  })

  it('落成的是 7 个样式上的 25 条变体，不是 25 个样式', () => {
    const after = ALL_SUBJECTS.reduce(
      (sum, subject) => sum + subject.style.variants.length,
      0,
    )
    const before = [
      ...TWIN_2D_SOURCE_STYLES,
      ...TWIN_2D_TERMINAL_STYLES,
    ].reduce((sum, style) => sum + style.variants.length, 0)

    expect(ALL_SUBJECTS.length).toBe(7)
    expect(after - before).toBe(25)
  })

  it('每条子类变体的条件都是 `tag` 一档、键都是 subtype、取值集合各只有一个', () => {
    const defs = [
      ...TWIN_2D_SOURCE_SUBTYPE_DEFS,
      ...TWIN_2D_TERMINAL_SUBTYPE_DEFS,
    ]

    expect(defs.map((def) => twin2dSubtypeVariant(def, 'x').when)).toEqual(
      defs.map((def) => ({
        kind: 'tag',
        key: TWIN_2D_SUBTYPE_TAG_KEY,
        in: [def.id],
      })),
    )
  })

  it('那两批样式自己一条子类变体都没有，25 条都出自这一份数据', () => {
    const ids = [...TWIN_2D_SOURCE_STYLES, ...TWIN_2D_TERMINAL_STYLES].flatMap(
      (style) => style.variants.map((variant) => variant.id),
    )

    expect(ids.filter((id) => id.startsWith('subtype-'))).toEqual([])
  })
})

describe('25 种组合逐条', () => {
  it.each(ALL_COMBOS)('$styleId 打上 subtype=$subtypeId', (combo) => {
    const hit = applyVariants(
      combo.style.prims,
      combo.style.variants,
      tagCtx(combo.subtypeId),
    )

    expect(spriteAt(hit.prims, combo.glyphPrimId)).toBe(combo.def.sprite)
    // 末端三档不动强调色：参考项目没有 TERMINAL_KIND_COLOR，补一个就是凭空多出三种配色
    expect(hit.root.accent ?? null).toBe(combo.def.accent)
  })

  it.each(ALL_SUBJECTS)(
    '$styleId 不打 subtype 时用的是类型自带的那枚图标、也不覆盖强调色',
    (subject) => {
      const bare = applyVariants(
        subject.style.prims,
        subject.style.variants,
        bareCtx(),
      )

      expect(spriteAt(bare.prims, subject.glyphPrimId)).toBe(subject.baseSprite)
      expect(bare.root.accent).toBeUndefined()
    },
  )

  it('25 条里 18 条真换了图标，另 7 条是「类型与子类同族」的对角线', () => {
    const same = ALL_COMBOS.filter(
      (combo) => combo.def.sprite === combo.baseSprite,
    )

    expect(ALL_COMBOS.length - same.length).toBe(18)
    expect(same.map((combo) => [combo.styleId, combo.subtypeId])).toEqual([
      ['waste-heat-source', 'waste-heat'],
      ['steam-source', 'steam'],
      ['air-source', 'air-energy'],
      ['solar-source', 'solar'],
      ['bath-terminal', 'shower'],
      ['heating-terminal', 'heating'],
      ['ac-terminal', 'hvac'],
    ])
  })

  it('25 条换上去的 sprite id 全在 TWIN_2D_SPRITE_IDS 里', () => {
    const known = new Set<string>(TWIN_2D_SPRITE_IDS)

    expect(
      ALL_COMBOS.map((combo) => combo.def.sprite).filter(
        (id) => !known.has(id),
      ),
    ).toEqual([])
  })

  it('源子类的四个强调色逐值等于参考项目 SOURCE_CLASS_COLOR 那四个 --chart-series-*', () => {
    expect(
      TWIN_2D_SOURCE_SUBTYPE_DEFS.map((def) => [
        def.id,
        def.sprite,
        def.accent,
      ]),
    ).toEqual([
      ['waste-heat', 'ico-src-waste-heat', '#62ff8a'],
      ['solar', 'ico-src-solar', '#2fe9ff'],
      ['air-energy', 'ico-src-air-source', '#ff9b54'],
      ['steam', 'ico-src-steam', '#ff5c7a'],
    ])
  })

  it('末端子类换的只有图标，三条 accent 全是 null', () => {
    expect(
      TWIN_2D_TERMINAL_SUBTYPE_DEFS.map((def) => [
        def.id,
        def.sprite,
        def.accent,
      ]),
    ).toEqual([
      ['shower', 'ico-term-shower', null],
      ['hvac', 'ico-term-ac', null],
      ['heating', 'ico-term-radiator', null],
    ])
  })
})

describe('子类变体排在交互态之前', () => {
  it('源类样式的变体序是「4 条子类 → hover → selected → alarm → 3 条名位」', () => {
    const style = styleOf(TWIN_2D_SUBTYPED_SOURCE_STYLES, 'waste-heat-source')

    expect(style.variants.map((variant) => variant.id)).toEqual([
      'subtype-waste-heat',
      'subtype-solar',
      'subtype-air-energy',
      'subtype-steam',
      'hover',
      'selected',
      'alarm',
      'label-left',
      'label-right',
      'label-inside',
    ])
  })

  it('末端样式的变体序是「3 条子类 → hover → selected → alarm → 3 条名位」', () => {
    const style = styleOf(TWIN_2D_SUBTYPED_TERMINAL_STYLES, 'ac-terminal')

    expect(style.variants.map((variant) => variant.id)).toEqual([
      'subtype-shower',
      'subtype-hvac',
      'subtype-heating',
      'hover',
      'selected',
      'alarm',
      'label-left',
      'label-right',
      'label-inside',
    ])
  })

  it('子类与 hover 同时命中时两份根补丁并存：accent 归子类、抬升缩放归 hover', () => {
    const style = styleOf(TWIN_2D_SUBTYPED_SOURCE_STYLES, 'steam-source')
    const ctx: Twin2dVariantCtx = {
      ...tagCtx('solar'),
      states: new Set(['hover']),
    }

    const hit = applyVariants(style.prims, style.variants, ctx)

    expect(hit.root).toEqual({
      accent: '#2fe9ff',
      lift: 3,
      scale: 1.025,
      z: 30,
    })
    expect(spriteAt(hit.prims, TWIN_2D_SOURCE_GLYPH_PRIM_ID)).toBe(
      'ico-src-solar',
    )
  })
})

describe('tag 的键与值不做白名单', () => {
  it('自造的子类值原样留在 tags 里，不被归一化丢掉', () => {
    const tags = normalizeTags({
      [TWIN_2D_SUBTYPE_TAG_KEY]: '  地源热泵  ',
      phase: 'L1',
      voltage: '10kV',
    })

    expect(tags).toEqual({
      [TWIN_2D_SUBTYPE_TAG_KEY]: '地源热泵',
      phase: 'L1',
      voltage: '10kV',
    })
  })

  it('自造的 tag 条件归一化后原样保留，键也不必是 subtype', () => {
    const cond = normalizeCondition({
      kind: 'tag',
      key: 'voltage',
      in: ['10kV', '35kV'],
    })

    expect(cond).toEqual({ kind: 'tag', key: 'voltage', in: ['10kV', '35kV'] })
  })

  it('用户拿自造的子类值配一条变体，照样命中', () => {
    const mine: Twin2dSubtypeDef = {
      id: '地源热泵',
      label: '地源热泵',
      sprite: 'ico-vsl-manifold',
      accent: '#123456',
    }
    const style = twin2dWithSubtypes(
      styleOf(TWIN_2D_SUBTYPED_SOURCE_STYLES, 'air-source'),
      [mine],
      TWIN_2D_SOURCE_GLYPH_PRIM_ID,
    )

    const hit = applyVariants(style.prims, style.variants, tagCtx('地源热泵'))

    expect(spriteAt(hit.prims, TWIN_2D_SOURCE_GLYPH_PRIM_ID)).toBe(
      'ico-vsl-manifold',
    )
    expect(hit.root.accent).toBe('#123456')
  })

  it('自造的那条变体过得了 normalizeVariant，不会在落库回读时蒸发', () => {
    const mine: Twin2dSubtypeDef = {
      id: '地源热泵',
      label: '地源热泵',
      sprite: 'ico-vsl-tank',
      accent: '#abcdef',
    }
    const raw = twin2dSubtypeVariant(mine, TWIN_2D_SOURCE_GLYPH_PRIM_ID)

    expect(normalizeVariant(raw)).toEqual(raw)
  })
})

describe('同一样式上两条 tag 变体都命中', () => {
  /** 两条条件一模一样、只差 id 与补丁的变体。 */
  function twinVariants(): [Twin2dVariant, Twin2dVariant] {
    const when: Twin2dVariant['when'] = {
      kind: 'tag',
      key: TWIN_2D_SUBTYPE_TAG_KEY,
      in: ['solar'],
    }
    return [
      {
        id: 'earlier',
        when,
        patch: {
          [TWIN_2D_SOURCE_GLYPH_PRIM_ID]: {
            src: { kind: 'sprite', id: 'ico-tap' },
          },
        },
        rootPatch: { accent: '#111111' },
      },
      {
        id: 'later',
        when,
        patch: {
          [TWIN_2D_SOURCE_GLYPH_PRIM_ID]: {
            src: { kind: 'sprite', id: 'ico-hx' },
          },
        },
        rootPatch: { accent: '#222222' },
      },
    ]
  }

  const BASE = styleOf(TWIN_2D_SUBTYPED_SOURCE_STYLES, 'solar-source')

  it('文档序在后的赢——图元补丁与根补丁两处都是', () => {
    const [earlier, later] = twinVariants()

    const hit = applyVariants(
      BASE.prims,
      [...BASE.variants, earlier, later],
      tagCtx('solar'),
    )

    expect(spriteAt(hit.prims, TWIN_2D_SOURCE_GLYPH_PRIM_ID)).toBe('ico-hx')
    expect(hit.root.accent).toBe('#222222')
  })

  it('把两条掉个个儿，赢的就换成另一条——证明比的是序，不是别的', () => {
    const [earlier, later] = twinVariants()

    const hit = applyVariants(
      BASE.prims,
      [...BASE.variants, later, earlier],
      tagCtx('solar'),
    )

    expect(spriteAt(hit.prims, TWIN_2D_SOURCE_GLYPH_PRIM_ID)).toBe('ico-tap')
    expect(hit.root.accent).toBe('#111111')
  })

  it('内置那条排在前面，所以用户后加的那条盖得住内置子类', () => {
    const ids = BASE.variants.map((variant) => variant.id)
    const [earlier] = twinVariants()

    const hit = applyVariants(
      BASE.prims,
      [...BASE.variants, earlier],
      tagCtx('solar'),
    )

    expect(ids.indexOf('subtype-solar')).toBeLessThan(ids.indexOf('hover'))
    expect(hit.root.accent).toBe('#111111')
  })
})
