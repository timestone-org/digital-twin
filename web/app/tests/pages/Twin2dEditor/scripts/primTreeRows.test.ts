/**
 * @fileoverview 契约：图元树摊平成一列时，每一枚前面一道插入缝、每一层末尾再补一道
 * （空盒里那一道也在），落点的下标按**动之前**那张表数；四种新图元的种子落地之后
 * 都得画得出东西来。
 *
 * ⚠ 少了尾缝就没法把一枚图元拖到某一层的最后一位，空盒更是一个落点都没有——
 * 表现是「这个盒子放不进东西」，而这一步零报错。
 * ⚠ 落点下标在这里先减一次的话整体差一格：`movePrim` 自己会替同级往后挪的那一手减。
 * ⚠ 种子只给 `kind` 的话，归一化补出来的是一枚什么都不画的图元：加完之后画面上毫无
 * 变化，用户只会以为按钮坏了。
 */
import { TWIN_2D_PRIM_KINDS, normalizePrims } from '@dt/twin2d'
import type { Twin2dPrim, Twin2dPrimKind } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_PRIM_KIND_ICONS,
  TWIN_2D_PRIM_KIND_LABELS,
  TWIN_2D_PRIM_SEEDS,
  twin2dPrimAddAt,
  twin2dPrimRows,
} from '@/pages/Twin2dEditor/scripts/primTreeRows'
import type { Twin2dPrimRow } from '@/pages/Twin2dEditor/scripts/primTreeRows'

/** 一棵三层的树：盒 a 里一枚隐藏文本与一个空盒，根层另有一枚带条件的矢量。 */
const PRIMS: readonly Twin2dPrim[] = normalizePrims(
  [
    {
      id: 'a',
      kind: 'box',
      children: [
        { id: 'a1', kind: 'txt', hidden: true },
        { id: 'a2', kind: 'box', children: [] },
      ],
    },
    { id: 'b', kind: 'vec', when: { kind: 'state', state: 'hover' } },
  ],
  0,
)

const ROWS = twin2dPrimRows(PRIMS)

/**
 * 按 key 取一档。
 * @param key 那一档的 key
 */
function rowOf(key: string): Twin2dPrimRow {
  const found = ROWS.find((row) => row.key === key)
  if (found === undefined) throw new Error(`没有 ${key} 这一档`)
  return found
}

/**
 * 一枚归一化之后的种子图元。
 * @param kind 四种之一
 */
function seedPrim(kind: Twin2dPrimKind): Twin2dPrim {
  const prim = normalizePrims([{ ...TWIN_2D_PRIM_SEEDS[kind], id: 'x' }], 0)[0]
  if (prim === undefined) throw new Error(`${kind} 的种子落不了地`)
  return prim
}

/**
 * 这一枚落地之后画得出东西来。
 * @param prim 归一化之后的图元
 */
function paints(prim: Twin2dPrim): boolean {
  if (prim.kind === 'box') return prim.border.width > 0 || prim.fills.length > 0
  if (prim.kind === 'vec') return prim.strokes.length > 0
  if (prim.kind === 'ico') return prim.src.kind !== 'none'
  return prim.src.kind !== 'lit' || prim.src.text !== ''
}

describe('摊平', () => {
  it('深度优先按文档序摊开，每一枚前面一道缝、每一层末尾再补一道', () => {
    expect(ROWS.map((row) => row.key)).toEqual([
      'row:a',
      'row:a1',
      'row:a2',
      'end:a2',
      'end:a',
      'row:b',
      'end:',
    ])
  })

  // ⚠ 没有这一道，空盒连一个落点都没有——表现是「这个盒子放不进东西」
  it('空盒里也有一道自己的尾缝，落点就是它的第 0 位', () => {
    const tail = rowOf('end:a2')

    expect(tail.hasRow).toBe(false)
    expect(tail.spot).toEqual({ parentId: 'a2', index: 0 })
    expect(tail.depth).toBe(2)
  })

  it('落点的下标按动之前那张表数，不在这里先减一格', () => {
    expect(rowOf('row:a').spot).toEqual({ parentId: null, index: 0 })
    expect(rowOf('row:b').spot).toEqual({ parentId: null, index: 1 })
    expect(rowOf('end:').spot).toEqual({ parentId: null, index: 2 })
  })

  it('缩进层深从根层 0 数起', () => {
    expect([rowOf('row:a').depth, rowOf('row:a1').depth]).toEqual([0, 1])
  })

  it('只有盒接得住「拖进来当最后一个子」，并报得出现有几个子', () => {
    expect(rowOf('row:a').isBox).toBe(true)
    expect(rowOf('row:a').childCount).toBe(2)
    expect(rowOf('row:b').isBox).toBe(false)
    expect(rowOf('row:b').childCount).toBe(0)
  })

  // ⚠ 行的 key 不带前缀的话，一个名叫 `end:` 的图元 id 会让 Vue 复用错行
  it('图元行与尾缝的 key 各带各的前缀，撞不到一起', () => {
    const keys = ROWS.map((row) => row.key)

    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter((key) => key.startsWith('row:'))).toHaveLength(4)
  })
})

describe('行上摆什么', () => {
  it('kind 与 id 都摆出来：id 是补丁与变体的寻址键', () => {
    expect(rowOf('row:b').id).toBe('b')
    expect(rowOf('row:b').kindLabel).toBe(TWIN_2D_PRIM_KIND_LABELS.vec)
    expect(rowOf('row:b').icon).toBe(TWIN_2D_PRIM_KIND_ICONS.vec)
  })

  // ⚠ 隐藏的图元在画面上什么都没有，不标出来的话用户只会一遍遍去改它的样式
  it('隐藏、有条件与子数都写进副名', () => {
    expect(rowOf('row:a1').note).toBe('隐藏')
    expect(rowOf('row:b').note).toBe('有条件')
    expect(rowOf('row:a').note).toBe('2 子')
  })

  it('尾缝那一档不带图元的任何字段', () => {
    const tail = rowOf('end:')

    expect(tail.id).toBe('')
    expect(tail.note).toBe('')
    expect(tail.isBox).toBe(false)
  })
})

describe('新图元落在哪', () => {
  it('一枚都没选就落到根层末尾', () => {
    expect(twin2dPrimAddAt(PRIMS, '')).toEqual({
      spot: { parentId: null, index: 2 },
      hint: '新图元落在根层末尾',
    })
  })

  // ⚠ 选中一个盒再点新增，用户要的是往这个盒里装东西，不是排在盒后面
  it('选中的是盒就落进它末尾', () => {
    expect(twin2dPrimAddAt(PRIMS, 'a').spot).toEqual({
      parentId: 'a',
      index: 2,
    })
  })

  it('选中的不是盒就排在它后面，落在它自己那一层', () => {
    expect(twin2dPrimAddAt(PRIMS, 'a1').spot).toEqual({
      parentId: 'a',
      index: 1,
    })
  })

  it('选中的那一枚已经不在了也落回根层末尾，不指着空处', () => {
    expect(twin2dPrimAddAt(PRIMS, 'gone').spot).toEqual({
      parentId: null,
      index: 2,
    })
  })

  it('落点那句话把落在哪说出来', () => {
    expect(twin2dPrimAddAt(PRIMS, 'a').hint).toContain('a')
    expect(twin2dPrimAddAt(PRIMS, 'b').hint).toContain('b')
  })
})

describe('四种种子', () => {
  it('每一种都落得了地，kind 就是点的那一种', () => {
    expect(TWIN_2D_PRIM_KINDS.map((kind) => seedPrim(kind).kind)).toEqual([
      ...TWIN_2D_PRIM_KINDS,
    ])
  })

  // ⚠ 只给 kind 的话补出来的是一枚什么都不画的图元，加完画面毫无变化
  it('落地之后都画得出东西来，不是一枚什么都不画的图元', () => {
    const drawn = TWIN_2D_PRIM_KINDS.map((kind) => paints(seedPrim(kind)))

    expect(drawn).toEqual([true, true, true, true])
  })

  it('图标那一枚给的是登记过的图标名，不是空档', () => {
    const prim = seedPrim('ico')

    expect(prim.kind === 'ico' && prim.src.kind === 'name').toBe(true)
  })
})
