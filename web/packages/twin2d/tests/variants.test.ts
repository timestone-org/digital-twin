/**
 * @fileoverview 锁住变体求值的三件事：七档条件的真假判定（`slot` 与阈值卡片同义、
 * `not` 可嵌套）、命中变体保持文档序且后者覆盖前者、以及「产出的是补丁不是新树」——
 * 没被补丁碰到的图元必须返回**原引用**，否则 hover 一个节点就重绘整张图。
 */
import { describe, expect, it } from 'vitest'

import { normalizeNode } from '../src/normalizeNodes'
import { normalizePrim } from '../src/normalizePrims'
import type {
  Twin2dIcoPrim,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dTxtPrim,
} from '../src/typesPrim'
import type { Twin2dVariant } from '../src/types'
import {
  activeVariants,
  applyVariants,
  evalCondition,
  nodeFields,
} from '../src/variants'
import type { Twin2dVariantCtx } from '../src/variants'

/** 夹具走真归一化，缺席字段拿的就是生产缺省 */
function prim(raw: Record<string, unknown>): Twin2dPrim {
  const one = normalizePrim(raw, 0)
  if (one === null) throw new Error('夹具建不出图元')
  return one
}

function ctxOf(over: Partial<Twin2dVariantCtx> = {}): Twin2dVariantCtx {
  return {
    states: new Set(),
    status: null,
    tags: new Map(),
    slots: new Map(),
    fields: new Map(),
    ...over,
  }
}

function variantOf(
  id: string,
  when: Twin2dVariant['when'],
  patch: Record<string, Twin2dPrimPatch> = {},
  rootPatch: Twin2dVariant['rootPatch'] = {},
): Twin2dVariant {
  return { id, when, patch, rootPatch }
}

/** 一个装着图标与标题的两层盒 */
function sampleTree(): readonly Twin2dPrim[] {
  return [
    prim({
      id: 'frame',
      kind: 'box',
      children: [
        {
          id: 'icon-pad',
          kind: 'box',
          children: [
            { id: 'icon', kind: 'ico', src: { kind: 'name', name: 'a' } },
          ],
        },
        { id: 'title', kind: 'txt', src: { kind: 'label' } },
      ],
    }),
    prim({ id: 'outline', kind: 'vec', shape: { kind: 'rect' } }),
  ]
}

function boxAt(prims: readonly Twin2dPrim[], index: number): Twin2dPrim {
  const one = prims[index]
  if (one === undefined) throw new Error('夹具下标越界')
  return one
}

function childrenOf(one: Twin2dPrim): readonly Twin2dPrim[] {
  if (one.kind !== 'box') throw new Error('这不是一个盒')
  return one.children
}

function childAt(one: Twin2dPrim, index: number): Twin2dPrim {
  const kid = childrenOf(one)[index]
  if (kid === undefined) throw new Error('夹具下标越界')
  return kid
}

function iconOf(prims: readonly Twin2dPrim[]): Twin2dIcoPrim {
  const one = childAt(childAt(boxAt(prims, 0), 0), 0)
  if (one.kind !== 'ico') throw new Error('这不是一个 ico')
  return one
}

function titleOf(prims: readonly Twin2dPrim[]): Twin2dTxtPrim {
  const one = childAt(boxAt(prims, 0), 1)
  if (one.kind !== 'txt') throw new Error('这不是一个 txt')
  return one
}

describe('evalCondition · state 档', () => {
  it('本地 ref 报了 hover 就命中——hover 是喂进来的，不是 CSS 伪类', () => {
    const ctx = ctxOf({ states: new Set(['hover']) })
    expect(evalCondition({ kind: 'state', state: 'hover' }, ctx)).toBe(true)
  })

  it('没报 hover 就不命中，别的态开着也不算', () => {
    const ctx = ctxOf({ states: new Set(['selected']) })
    expect(evalCondition({ kind: 'state', state: 'hover' }, ctx)).toBe(false)
  })
})

describe('evalCondition · status 档', () => {
  it('状态落在集合里就命中', () => {
    const ctx = ctxOf({ status: 'alarm' })
    expect(
      evalCondition({ kind: 'status', in: ['warning', 'alarm'] }, ctx),
    ).toBe(true)
  })

  it('状态不在集合里不命中', () => {
    const ctx = ctxOf({ status: 'online' })
    expect(evalCondition({ kind: 'status', in: ['alarm'] }, ctx)).toBe(false)
  })

  it('不画状态的节点（status 为 null）一律不命中，不许当成 online', () => {
    expect(evalCondition({ kind: 'status', in: ['online'] }, ctxOf())).toBe(
      false,
    )
  })
})

describe('evalCondition · tag 档', () => {
  it('tags 上的值落在集合里就命中——子类靠这一档', () => {
    const ctx = ctxOf({ tags: new Map([['subtype', 'solar']]) })
    expect(
      evalCondition({ kind: 'tag', key: 'subtype', in: ['solar'] }, ctx),
    ).toBe(true)
  })

  it('键上没有值时不命中', () => {
    const ctx = ctxOf({ tags: new Map([['medium', 'steam']]) })
    expect(
      evalCondition({ kind: 'tag', key: 'subtype', in: ['solar'] }, ctx),
    ).toBe(false)
  })

  it('值不在集合里不命中', () => {
    const ctx = ctxOf({ tags: new Map([['subtype', 'steam']]) })
    expect(
      evalCondition({ kind: 'tag', key: 'subtype', in: ['solar'] }, ctx),
    ).toBe(false)
  })
})

describe('evalCondition · slot 档的八个算子', () => {
  const ctx = ctxOf({ slots: new Map([['t', 50]]) })

  function slotHit(
    op: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'between' | 'outside',
    value: number | null,
    value2: number | null = null,
  ): boolean {
    return evalCondition({ kind: 'slot', slot: 't', op, value, value2 }, ctx)
  }

  it('lt 只在严格小于时成立', () => {
    expect([slotHit('lt', 60), slotHit('lt', 50)]).toEqual([true, false])
  })

  it('lte 含端点', () => {
    expect([slotHit('lte', 50), slotHit('lte', 49)]).toEqual([true, false])
  })

  it('gt 只在严格大于时成立', () => {
    expect([slotHit('gt', 40), slotHit('gt', 50)]).toEqual([true, false])
  })

  it('gte 含端点', () => {
    expect([slotHit('gte', 50), slotHit('gte', 51)]).toEqual([true, false])
  })

  it('eq 与 neq 互为反面', () => {
    expect([slotHit('eq', 50), slotHit('neq', 50)]).toEqual([true, false])
  })

  it('between 是闭区间，与阈值卡片同义', () => {
    expect([slotHit('between', 50, 60), slotHit('between', 51, 60)]).toEqual([
      true,
      false,
    ])
  })

  it('outside 是闭区间之外', () => {
    expect([slotHit('outside', 51, 60), slotHit('outside', 40, 60)]).toEqual([
      true,
      false,
    ])
  })

  it('上下界写反了照样按小的当下界，不是判不中', () => {
    expect(slotHit('between', 60, 40)).toBe(true)
  })

  it('区间档缺上界一律判不中——拿单值当区间比会变成「≥下界就报警」', () => {
    expect([slotHit('between', 40), slotHit('outside', 40)]).toEqual([
      false,
      false,
    ])
  })

  it('阈值本身缺省时判不中', () => {
    expect(slotHit('gt', null)).toBe(false)
  })

  it('槽位没值或不是有限数时判不中', () => {
    const empty = ctxOf({ slots: new Map([['t', 'n/a']]) })
    expect(
      evalCondition(
        { kind: 'slot', slot: 't', op: 'gt', value: 0, value2: null },
        empty,
      ),
    ).toBe(false)
  })

  it('⚠ 数字字符串一律不参与比较：实时读数上的引号是脏数据不是笔误', () => {
    const text = ctxOf({ slots: new Map([['t', '60']]) })
    expect(
      evalCondition(
        { kind: 'slot', slot: 't', op: 'gt', value: 40, value2: null },
        text,
      ),
    ).toBe(false)
  })
})

describe('evalCondition · has 档', () => {
  const ctx = ctxOf({
    slots: new Map<string, unknown>([
      ['input_kwh', 0],
      ['output_kwh', null],
      ['note', ' 检修 '],
    ]),
  })

  it('any：任一槽有值就命中，显式 0 算有值', () => {
    expect(
      evalCondition(
        { kind: 'has', slots: ['input_kwh', 'output_kwh'], mode: 'any' },
        ctx,
      ),
    ).toBe(true)
  })

  it('any：全都没值才不命中', () => {
    expect(
      evalCondition(
        { kind: 'has', slots: ['output_kwh', 'missing'], mode: 'any' },
        ctx,
      ),
    ).toBe(false)
  })

  it('all：每个槽都要有值，文本槽也算', () => {
    expect(
      evalCondition(
        { kind: 'has', slots: ['input_kwh', 'note'], mode: 'all' },
        ctx,
      ),
    ).toBe(true)
  })

  it('数字字符串在这一档照旧算「有值」——判的是有没有，不是能不能比大小', () => {
    const text = ctxOf({ slots: new Map([['v', '60']]) })
    expect(
      evalCondition({ kind: 'has', slots: ['v'], mode: 'all' }, text),
    ).toBe(true)
  })

  it('all：缺一个就不命中', () => {
    expect(
      evalCondition(
        { kind: 'has', slots: ['input_kwh', 'output_kwh'], mode: 'all' },
        ctx,
      ),
    ).toBe(false)
  })
})

describe('evalCondition · not 档', () => {
  it('取反一层', () => {
    const ctx = ctxOf({ status: 'online' })
    expect(
      evalCondition(
        { kind: 'not', of: { kind: 'status', in: ['alarm'] } },
        ctx,
      ),
    ).toBe(true)
  })

  it('嵌套一层的 not 抵消回原判定', () => {
    const ctx = ctxOf({ states: new Set(['selected']) })
    expect(
      evalCondition(
        {
          kind: 'not',
          of: { kind: 'not', of: { kind: 'state', state: 'selected' } },
        },
        ctx,
      ),
    ).toBe(true)
  })
})

describe('activeVariants', () => {
  it('只留命中的，且保持文档序——重排就是改渲染结果', () => {
    const list = [
      variantOf('a', { kind: 'state', state: 'hover' }),
      variantOf('b', { kind: 'status', in: ['alarm'] }),
      variantOf('c', { kind: 'state', state: 'selected' }),
    ]
    const ctx = ctxOf({ states: new Set(['hover', 'selected']) })
    expect(activeVariants(list, ctx).map((one) => one.id)).toEqual(['a', 'c'])
  })

  it('一条都不命中时给空表', () => {
    const list = [variantOf('a', { kind: 'state', state: 'hover' })]
    expect(activeVariants(list, ctxOf())).toEqual([])
  })
})

describe('applyVariants · 浅合并', () => {
  const hover = ctxOf({ states: new Set(['hover']) })

  it('只覆盖列出的键，没列出的原样保留', () => {
    const tree = sampleTree()
    const before = boxAt(tree, 1)
    const result = applyVariants(
      tree,
      [
        variantOf(
          'v',
          { kind: 'state', state: 'hover' },
          {
            outline: { opacity: 0.5 },
          },
        ),
      ],
      hover,
    )
    const after = boxAt(result.prims, 1)
    expect(after.opacity).toBe(0.5)
    expect(after.z).toBe(before.z)
    expect(after.at).toBe(before.at)
  })

  it('两条同时命中时文档序在后的赢——顺序反了会让其中一条永远不生效', () => {
    const result = applyVariants(
      sampleTree(),
      [
        variantOf(
          'first',
          { kind: 'state', state: 'hover' },
          {
            outline: { opacity: 0.2, rotate: 15 },
          },
        ),
        variantOf(
          'second',
          { kind: 'state', state: 'hover' },
          {
            outline: { opacity: 0.9 },
          },
        ),
      ],
      hover,
    )
    const after = boxAt(result.prims, 1)
    expect(after.opacity).toBe(0.9)
    expect(after.rotate).toBe(15)
  })

  it('rootPatch 同样是后者覆盖前者，未提的键留着', () => {
    const result = applyVariants(
      sampleTree(),
      [
        variantOf(
          'first',
          { kind: 'state', state: 'hover' },
          {},
          {
            z: 3,
            lift: 3,
          },
        ),
        variantOf('second', { kind: 'state', state: 'hover' }, {}, { z: 9 }),
      ],
      hover,
    )
    expect(result.root).toEqual({ z: 9, lift: 3 })
  })

  it('hover 那一档的抬升与等比缩放在同一份根覆盖里一起出来', () => {
    const result = applyVariants(
      sampleTree(),
      [
        variantOf(
          'hover',
          { kind: 'state', state: 'hover' },
          {},
          { lift: 3, scale: 1.025 },
        ),
      ],
      hover,
    )
    expect(result.root).toEqual({ lift: 3, scale: 1.025 })
  })

  it('图元级的 scale 与 rotate 一样是可补丁的基类键', () => {
    const result = applyVariants(
      sampleTree(),
      [
        variantOf(
          'hover',
          { kind: 'state', state: 'hover' },
          {
            outline: { scale: 1.08 },
          },
        ),
      ],
      hover,
    )
    expect(boxAt(result.prims, 1).scale).toBe(1.08)
  })

  it('一条都不命中时根覆盖是空对象', () => {
    const result = applyVariants(
      sampleTree(),
      [variantOf('v', { kind: 'state', state: 'hover' }, {}, { z: 9 })],
      ctxOf(),
    )
    expect(result.root).toEqual({})
  })
})

describe('applyVariants · 补丁不是新树', () => {
  const hover = ctxOf({ states: new Set(['hover']) })

  it('没被碰到的图元返回原引用，只有被改的那一枝换引用', () => {
    const tree = sampleTree()
    const frame = boxAt(tree, 0)
    const [pad, title] = childrenOf(frame)
    const result = applyVariants(
      tree,
      [
        variantOf(
          'v',
          { kind: 'state', state: 'hover' },
          {
            icon: { color: 'var(--t2-accent)' },
          },
        ),
      ],
      hover,
    )
    const nextFrame = boxAt(result.prims, 0)
    const [nextPad, nextTitle] = childrenOf(nextFrame)
    expect(nextTitle).toBe(title)
    expect(boxAt(result.prims, 1)).toBe(boxAt(tree, 1))
    expect(nextFrame).not.toBe(frame)
    expect(nextPad).not.toBe(pad)
  })

  it('一条变体都不命中时整棵树连数组都是原引用', () => {
    const tree = sampleTree()
    const result = applyVariants(
      tree,
      [
        variantOf(
          'v',
          { kind: 'state', state: 'hover' },
          {
            icon: { color: 'red' },
          },
        ),
      ],
      ctxOf(),
    )
    expect(result.prims).toBe(tree)
  })

  it('补丁指向不存在的图元 id 时静默跳过，树不动', () => {
    const tree = sampleTree()
    const result = applyVariants(
      tree,
      [
        variantOf(
          'v',
          { kind: 'state', state: 'hover' },
          {
            'no-such-prim': { opacity: 0 },
          },
        ),
      ],
      hover,
    )
    expect(result.prims).toBe(tree)
  })

  it('补到盒自己身上时盒换引用，子树数组不换', () => {
    const tree = sampleTree()
    const frame = boxAt(tree, 0)
    const result = applyVariants(
      tree,
      [
        variantOf(
          'v',
          { kind: 'state', state: 'hover' },
          {
            frame: { backdropBlur: 8, clip: true },
          },
        ),
      ],
      hover,
    )
    const nextFrame = boxAt(result.prims, 0)
    if (nextFrame.kind !== 'box' || frame.kind !== 'box') {
      throw new Error('夹具的根不是盒')
    }
    expect(nextFrame.backdropBlur).toBe(8)
    expect(nextFrame.children).toBe(frame.children)
  })
})

describe('applyVariants · 各种图元只吃自己认识的键', () => {
  const hover = ctxOf({ states: new Set(['hover']) })

  function patched(
    patch: Record<string, Twin2dPrimPatch>,
  ): readonly Twin2dPrim[] {
    return applyVariants(
      sampleTree(),
      [variantOf('v', { kind: 'state', state: 'hover' }, patch)],
      hover,
    ).prims
  }

  it('vec 吃 stretch 与 coord', () => {
    const after = boxAt(patched({ outline: { stretch: true, coord: 'px' } }), 1)
    if (after.kind !== 'vec') throw new Error('这不是一个 vec')
    expect([after.stretch, after.coord]).toEqual([true, 'px'])
  })

  it('ico 吃 sprite 来源与颜色', () => {
    const icon = iconOf(
      patched({
        icon: { src: { kind: 'sprite', id: 'ico-src-solar' }, color: '#fff' },
      }),
    )
    expect(icon.src).toEqual({ kind: 'sprite', id: 'ico-src-solar' })
    expect(icon.color).toBe('#fff')
  })

  it('喂给 ico 一个文本来源时静默跳过——换 kind 等于换渲染分支', () => {
    const icon = iconOf(
      patched({ icon: { src: { kind: 'label' }, color: '#000' } }),
    )
    expect(icon.src).toEqual({ kind: 'name', name: 'a' })
    expect(icon.color).toBe('#000')
  })

  it('txt 吃文本来源与排版键', () => {
    const title = titleOf(
      patched({ title: { src: { kind: 'lit', text: '热源' }, nowrap: true } }),
    )
    expect(title.src).toEqual({ kind: 'lit', text: '热源' })
    expect(title.nowrap).toBe(true)
  })

  it('喂给 txt 一个图标来源时静默跳过', () => {
    const title = titleOf(
      patched({
        title: { src: { kind: 'sprite', id: 'ico-tap' }, ellipsis: true },
      }),
    )
    expect(title.src).toEqual({ kind: 'label' })
    expect(title.ellipsis).toBe(true)
  })
})

describe('tag 档端到端：一个源类样式的四条子类变体', () => {
  /** 参考项目的四个源子类：换 sprite 与换强调色（§6.3） */
  const SUBTYPES = [
    ['waste-heat', 'ico-src-waste-heat', '#FF9B54'],
    ['solar', 'ico-src-solar', '#FFE65C'],
    ['air-energy', 'ico-src-air-source', '#7BD5FF'],
    ['steam', 'ico-src-steam', '#62DCFF'],
  ] as const

  const VARIANTS: readonly Twin2dVariant[] = SUBTYPES.map(
    ([subtype, sprite, accent]) =>
      variantOf(
        `subtype-${subtype}`,
        { kind: 'tag', key: 'subtype', in: [subtype] },
        { icon: { src: { kind: 'sprite', id: sprite } } },
        { accent },
      ),
  )

  for (const [subtype, sprite, accent] of SUBTYPES) {
    it(`子类 ${subtype} 换到自己的图标与配色，四条里只命中它一条`, () => {
      const ctx = ctxOf({ tags: new Map([['subtype', subtype]]) })
      const result = applyVariants(sampleTree(), VARIANTS, ctx)
      expect(iconOf(result.prims).src).toEqual({ kind: 'sprite', id: sprite })
      expect(result.root).toEqual({ accent })
    })
  }

  it('没标子类时四条都不命中，图标留在样式自带的那一枚', () => {
    const tree = sampleTree()
    const result = applyVariants(tree, VARIANTS, ctxOf())
    expect(iconOf(result.prims).src).toEqual({ kind: 'name', name: 'a' })
    expect(result.prims).toBe(tree)
    expect(result.root).toEqual({})
  })
})

describe('field 一档读节点上的三个闭合字段', () => {
  it('in 判据比的是字段当下的取值', () => {
    const cond = prim({
      id: 'p',
      kind: 'txt',
      when: { kind: 'field', field: 'labelPos', in: ['left', 'right'] },
    }).when
    if (cond === null) throw new Error('条件建不出来')

    expect(
      evalCondition(cond, ctxOf({ fields: new Map([['labelPos', 'left']]) })),
    ).toBe(true)
    expect(
      evalCondition(cond, ctxOf({ fields: new Map([['labelPos', 'bottom']]) })),
    ).toBe(false)
  })

  // ⚠ 取不到的字段按空串算：没有这一条，present 一档在「字段还没进上下文」时会当成有值
  it('present 判据只问有没有值，字段缺席按空串算', () => {
    const cond = prim({
      id: 'p',
      kind: 'txt',
      when: { kind: 'field', field: 'badge', test: 'present' },
    }).when
    if (cond === null) throw new Error('条件建不出来')

    expect(
      evalCondition(cond, ctxOf({ fields: new Map([['badge', 'A']]) })),
    ).toBe(true)
    expect(
      evalCondition(cond, ctxOf({ fields: new Map([['badge', '']]) })),
    ).toBe(false)
    expect(evalCondition(cond, ctxOf({}))).toBe(false)
  })

  it('nodeFields 只摊三个字段，且摊的是已归一化的取值', () => {
    const node = normalizeNode({
      id: 'n1',
      labelPos: 'inside',
      badge: ' A1 ',
      badgeShape: 'circle-number',
      tags: { labelPos: 'left' },
    })
    if (node === null) throw new Error('节点建不出来')

    expect([...nodeFields(node)]).toEqual([
      ['labelPos', 'inside'],
      ['badge', 'A1'],
      ['badgeShape', 'round'],
    ])
  })

  // ⚠ 两张表分开：合成一张的话用户自己写的同名 tag 就能改掉显示名位置
  it('同名 tag 进不了 field 一档', () => {
    const cond = prim({
      id: 'p',
      kind: 'txt',
      when: { kind: 'field', field: 'labelPos', in: ['left'] },
    }).when
    if (cond === null) throw new Error('条件建不出来')

    expect(
      evalCondition(cond, ctxOf({ tags: new Map([['labelPos', 'left']]) })),
    ).toBe(false)
  })
})
