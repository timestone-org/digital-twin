/**
 * @fileoverview 契约：图元树的增删改、同级层序与跨级搬家全是纯函数，改完再归一化不变形。
 *
 * ⚠ 复制一棵子树要**逐枚**重新发号：只换根那一枚的话，同 id 的两枚会被归一化按同层
 * 去重丢掉一枚，而节点级覆盖与变体补丁又都按 id 寻址。
 * ⚠ 超深与「拖进自己的子树」必须在动手之前拦住：交给归一化去截断的话，用户看到的是
 * 保存之后子树没了。
 * ⚠ 什么都没改时必须原样返回入参那个引用：文档态按引用判要不要压一帧撤销。
 */
import { TWIN_2D_MAX_PRIM_DEPTH, normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle, Twin2dPrim } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import type { Twin2dIdFactory } from '@/pages/Twin2dEditor/scripts/nodeOps'
import {
  addNodeLayer,
  addPrim,
  clearNodePrimPatch,
  duplicatePrim,
  findTwin2dPrim,
  movePrim,
  orderPrims,
  removeNodeLayer,
  removePrim,
  setNodePrimPatch,
  twin2dPrimHeight,
  twin2dPrimMoveBlock,
  twin2dPrimSpotBlock,
  updateNodeLayer,
  updatePrim,
} from '@/pages/Twin2dEditor/scripts/primOps'
import type { Twin2dPrimSeed } from '@/pages/Twin2dEditor/scripts/primOps'

/** 造 id 的桩：按调用次序发号且带上真实前缀。 */
function idSeq(): Twin2dIdFactory {
  let seq = 0
  return (prefix) => {
    seq += 1
    return `${prefix}-${seq}`
  }
}

/** 头一号固定发这个，之后才按前缀发号；用来逼出「新 id 撞上了」那一支。 */
function firstThen(first: string): Twin2dIdFactory {
  let seq = 0
  return (prefix) => {
    seq += 1
    return seq === 1 ? first : `${prefix}-${seq}`
  }
}

/**
 * 一串嵌 `levels` 层的盒（高 `levels - 1`）；`levels` 为 1 时就是一枚没有子树的盒。
 * @param levels 层数
 */
function tower(levels: number): Twin2dPrimSeed {
  const children = levels > 1 ? [tower(levels - 1)] : []
  return { id: `t${levels}`, kind: 'box', children }
}

function configOf(): Twin2dConfig {
  return normalizeTwin2dConfig({
    styles: [
      {
        id: 'sty',
        prims: [
          {
            id: 'a',
            kind: 'box',
            children: [
              { id: 'a1', kind: 'txt' },
              { id: 'a2', kind: 'box', children: [{ id: 'a2x', kind: 'vec' }] },
            ],
          },
          { id: 'b', kind: 'vec' },
        ],
        variants: [
          {
            id: 'v1',
            when: { kind: 'state', state: 'hover' },
            patch: { a1: { hidden: true } },
          },
        ],
      },
    ],
    nodes: [
      { id: 'n1', styleId: 'sty' },
      { id: 'n2', styleId: 'sty' },
    ],
  })
}

/** 配置里那份样式；取不到就让用例当场红。 */
function styleOf(config: Twin2dConfig): Twin2dNodeStyle {
  const style = config.styles.at(0)
  if (style === undefined) throw new Error('样式不在')
  return style
}

/** 一棵树摊平之后的 id，深度优先。 */
function idsOf(prims: readonly Twin2dPrim[]): string[] {
  return prims.flatMap((prim) =>
    prim.kind === 'box' ? [prim.id, ...idsOf(prim.children)] : [prim.id],
  )
}

function primsOf(config: Twin2dConfig): readonly Twin2dPrim[] {
  return styleOf(config).prims
}

function layersOf(config: Twin2dConfig): readonly Twin2dPrim[] {
  return config.nodes.at(0)?.layers ?? []
}

describe('在树上定位', () => {
  it('根层那一枚的层深是 0', () => {
    const at = findTwin2dPrim(primsOf(configOf()), 'b')

    expect(at?.depth).toBe(0)
    expect(at?.parentId).toBeNull()
    expect(at?.index).toBe(1)
  })

  it('深层那一枚连父与下标一起交出来', () => {
    const at = findTwin2dPrim(primsOf(configOf()), 'a2x')

    expect(at?.depth).toBe(2)
    expect(at?.parentId).toBe('a2')
    expect(at?.index).toBe(0)
  })

  it('不在就给 null', () => {
    expect(findTwin2dPrim(primsOf(configOf()), '没有这个')).toBeNull()
  })

  it('叶子高 0，套两层的高 2', () => {
    const prims = primsOf(configOf())
    const box = findTwin2dPrim(prims, 'a')?.prim
    const leaf = findTwin2dPrim(prims, 'b')?.prim

    expect(box === undefined ? -1 : twin2dPrimHeight(box)).toBe(2)
    expect(leaf === undefined ? -1 : twin2dPrimHeight(leaf)).toBe(0)
  })
})

describe('落点收不收得下', () => {
  it('根层放一枚叶子放得下', () => {
    const block = twin2dPrimSpotBlock(
      styleOf(configOf()),
      { parentId: null, index: 0 },
      0,
    )

    expect(block).toBe('none')
  })

  it('父不是盒、或压根不在，都是落点没了', () => {
    const style = styleOf(configOf())

    expect(twin2dPrimSpotBlock(style, { parentId: 'b', index: 0 }, 0)).toBe(
      'missing',
    )
    expect(
      twin2dPrimSpotBlock(style, { parentId: '没有这个', index: 0 }, 0),
    ).toBe('missing')
  })

  it('深度按上限算：正好占满收得下，多一层就拦住', () => {
    const style = styleOf(configOf())
    const room = TWIN_2D_MAX_PRIM_DEPTH - 1 - 2

    expect(twin2dPrimSpotBlock(style, { parentId: 'a2', index: 0 }, room)).toBe(
      'none',
    )
    expect(
      twin2dPrimSpotBlock(style, { parentId: 'a2', index: 0 }, room + 1),
    ).toBe('depth')
  })

  it('根层也拦：一棵占满整个上限的树放得下，再高一层不行', () => {
    const style = styleOf(configOf())
    const room = TWIN_2D_MAX_PRIM_DEPTH - 1

    expect(twin2dPrimSpotBlock(style, { parentId: null, index: 0 }, room)).toBe(
      'none',
    )
    expect(
      twin2dPrimSpotBlock(style, { parentId: null, index: 0 }, room + 1),
    ).toBe('depth')
  })
})

describe('搬家拦不拦得住', () => {
  it('拖进自己的子树里要拦住', () => {
    const style = styleOf(configOf())

    expect(twin2dPrimMoveBlock(style, 'a', { parentId: 'a2', index: 0 })).toBe(
      'cycle',
    )
    expect(twin2dPrimMoveBlock(style, 'a', { parentId: 'a', index: 0 })).toBe(
      'cycle',
    )
  })

  it('图元不在就说不在', () => {
    const style = styleOf(configOf())

    expect(
      twin2dPrimMoveBlock(style, '没有这个', { parentId: null, index: 0 }),
    ).toBe('missing')
  })

  it('叶子往盒里挪放行', () => {
    const style = styleOf(configOf())

    expect(twin2dPrimMoveBlock(style, 'b', { parentId: 'a2', index: 0 })).toBe(
      'none',
    )
  })

  it('把一棵高子树往深处挪要按整棵树的高度拦', () => {
    const added = addPrim(
      configOf(),
      styleOf(configOf()),
      { parentId: null, index: 0 },
      tower(5),
      idSeq(),
    )
    const style = styleOf(added.config)

    expect(
      twin2dPrimMoveBlock(style, 'prim-1', { parentId: 'a2', index: 0 }),
    ).toBe('depth')
  })
})

describe('新增图元', () => {
  it('下标越界就落到那一层的末尾', () => {
    const config = configOf()
    const added = addPrim(
      config,
      styleOf(config),
      { parentId: null, index: 99 },
      { kind: 'txt' },
      idSeq(),
    )

    expect(added.id).toBe('prim-1')
    expect(idsOf(primsOf(added.config))).toEqual([
      'a',
      'a1',
      'a2',
      'a2x',
      'b',
      'prim-1',
    ])
  })

  it('落在一个盒里的指定位置', () => {
    const config = configOf()
    const added = addPrim(
      config,
      styleOf(config),
      { parentId: 'a', index: 0 },
      { kind: 'ico' },
      idSeq(),
    )

    expect(idsOf(primsOf(added.config))).toEqual([
      'a',
      'prim-1',
      'a1',
      'a2',
      'a2x',
      'b',
    ])
  })

  it('落点收不下时一步都不动，也不交出指不到实处的 id', () => {
    const config = configOf()
    const tooDeep = addPrim(
      config,
      styleOf(config),
      { parentId: 'a2', index: 0 },
      tower(TWIN_2D_MAX_PRIM_DEPTH),
      idSeq(),
    )
    const notABox = addPrim(
      config,
      styleOf(config),
      { parentId: 'b', index: 0 },
      { kind: 'txt' },
      idSeq(),
    )

    expect(tooDeep.id).toBeNull()
    expect(tooDeep.config).toBe(config)
    expect(notABox.id).toBeNull()
    expect(notABox.config).toBe(config)
  })

  it('缺省交给归一化补，加完再归一化不变形', () => {
    const config = configOf()
    const added = addPrim(
      config,
      styleOf(config),
      { parentId: null, index: 0 },
      { kind: 'txt' },
      idSeq(),
    )
    const fresh = findTwin2dPrim(primsOf(added.config), 'prim-1')?.prim

    expect(fresh?.opacity).toBe(1)
    expect(fresh?.hidden).toBe(false)
    expect(normalizeTwin2dConfig(added.config)).toEqual(added.config)
  })
})

describe('复制图元', () => {
  it('副本插在原件后面，子树里每一枚都重新发号', () => {
    const config = configOf()
    const copied = duplicatePrim(config, styleOf(config), 'a', idSeq())

    expect(copied.id).toBe('a-1')
    expect(idsOf(primsOf(copied.config))).toEqual([
      'a',
      'a1',
      'a2',
      'a2x',
      'a-1',
      'a1-2',
      'a2-3',
      'a2x-4',
      'b',
    ])
  })

  it('副本里一个 id 都不与原件重名', () => {
    const config = configOf()
    const copied = duplicatePrim(config, styleOf(config), 'a', idSeq())
    const all = idsOf(primsOf(copied.config))

    expect(new Set(all).size).toBe(all.length)
    expect(normalizeTwin2dConfig(copied.config)).toEqual(copied.config)
  })

  it('复制一枚叶子只发一个号', () => {
    const config = configOf()
    const copied = duplicatePrim(config, styleOf(config), 'b', idSeq())

    expect(idsOf(primsOf(copied.config))).toEqual([
      'a',
      'a1',
      'a2',
      'a2x',
      'b',
      'b-1',
    ])
  })

  it('图元不在就原样返回入参那份配置', () => {
    const config = configOf()
    const copied = duplicatePrim(config, styleOf(config), '没有这个', idSeq())

    expect(copied.id).toBeNull()
    expect(copied.config).toBe(config)
  })
})

describe('改与删', () => {
  it('换掉深层的一枚，别的枝原样带回', () => {
    const config = configOf()
    const target = findTwin2dPrim(primsOf(config), 'a2x')?.prim
    const next =
      target === undefined
        ? config
        : updatePrim(config, styleOf(config), { ...target, opacity: 0.5 })

    expect(findTwin2dPrim(primsOf(next), 'a2x')?.prim.opacity).toBe(0.5)
    expect(findTwin2dPrim(primsOf(next), 'b')?.prim).toBe(
      findTwin2dPrim(primsOf(config), 'b')?.prim,
    )
  })

  it('换掉根层的一枚，同层别的那些连引用都不换', () => {
    const config = configOf()
    const target = findTwin2dPrim(primsOf(config), 'b')?.prim
    const next =
      target === undefined
        ? config
        : updatePrim(config, styleOf(config), { ...target, opacity: 0.25 })

    expect(findTwin2dPrim(primsOf(next), 'b')?.prim.opacity).toBe(0.25)
    expect(primsOf(next).at(0)).toBe(primsOf(config).at(0))
  })

  it('换过 id 的那一枚只会被当成不在，配置原样返回', () => {
    const config = configOf()
    const target = findTwin2dPrim(primsOf(config), 'a1')?.prim
    const next =
      target === undefined
        ? config
        : updatePrim(config, styleOf(config), { ...target, id: '改过的' })

    expect(next).toBe(config)
  })

  it('删一枚盒把它的子树一起带走', () => {
    const config = configOf()
    const next = removePrim(config, styleOf(config), 'a2')

    expect(idsOf(primsOf(next))).toEqual(['a', 'a1', 'b'])
  })

  it('删不存在的原样返回入参那份配置', () => {
    const config = configOf()

    expect(removePrim(config, styleOf(config), '没有这个')).toBe(config)
  })

  it('指着它的变体补丁不跟着删，交给诊断去报', () => {
    const config = configOf()
    const next = removePrim(config, styleOf(config), 'a1')

    expect(styleOf(next).variants.at(0)?.patch).toEqual({
      a1: { hidden: true },
    })
  })
})

describe('同级层序', () => {
  it('盒里的一枚下移一层只与相邻的那个对调', () => {
    const config = configOf()
    const next = orderPrims(config, styleOf(config), 'a1', 'forward')

    expect(idsOf(primsOf(next))).toEqual(['a', 'a2', 'a2x', 'a1', 'b'])
  })

  it('已经到顶再上移就原样返回入参那份配置', () => {
    const config = configOf()

    expect(orderPrims(config, styleOf(config), 'a1', 'backward')).toBe(config)
    expect(orderPrims(config, styleOf(config), 'b', 'front')).toBe(config)
  })

  it('图元不在就原样返回入参那份配置', () => {
    const config = configOf()

    expect(orderPrims(config, styleOf(config), '没有这个', 'front')).toBe(
      config,
    )
  })

  it('置底把根层那一枚挪到表头', () => {
    const config = configOf()
    const next = orderPrims(config, styleOf(config), 'b', 'back')

    expect(idsOf(primsOf(next))).toEqual(['b', 'a', 'a1', 'a2', 'a2x'])
  })
})

describe('别的枝原样带回', () => {
  it('不含目标的兄弟盒连引用都不换', () => {
    const config = normalizeTwin2dConfig({
      styles: [
        {
          id: 'sty',
          prims: [
            { id: 'left', kind: 'box', children: [{ id: 'l1', kind: 'txt' }] },
            { id: 'right', kind: 'box', children: [{ id: 'r1', kind: 'txt' }] },
          ],
        },
      ],
    })
    const style = styleOf(config)
    const next = addPrim(
      config,
      style,
      { parentId: 'right', index: 0 },
      { kind: 'vec' },
      idSeq(),
    )

    expect(idsOf(primsOf(next.config))).toEqual([
      'left',
      'l1',
      'right',
      'prim-1',
      'r1',
    ])
    expect(primsOf(next.config).at(0)).toBe(style.prims.at(0))
  })
})

describe('跨级搬家', () => {
  it('根层的一枚挪进深处的盒里', () => {
    const config = configOf()
    const next = movePrim(config, styleOf(config), 'b', {
      parentId: 'a2',
      index: 0,
    })

    expect(idsOf(primsOf(next))).toEqual(['a', 'a1', 'a2', 'b', 'a2x'])
  })

  it('盒里的一枚挪回根层', () => {
    const config = configOf()
    const next = movePrim(config, styleOf(config), 'a2', {
      parentId: null,
      index: 0,
    })

    expect(idsOf(primsOf(next))).toEqual(['a2', 'a2x', 'a', 'a1', 'b'])
  })

  it('同级往后拖时下标按动之前那张表数，不必自己减一', () => {
    const config = configOf()
    const next = movePrim(config, styleOf(config), 'a', {
      parentId: null,
      index: 2,
    })

    expect(idsOf(primsOf(next))).toEqual(['b', 'a', 'a1', 'a2', 'a2x'])
  })

  it('拦住的那几档一步都不动', () => {
    const config = configOf()
    const cycle = movePrim(config, styleOf(config), 'a', {
      parentId: 'a2x',
      index: 0,
    })
    const missing = movePrim(config, styleOf(config), '没有这个', {
      parentId: null,
      index: 0,
    })

    expect(cycle).toBe(config)
    expect(missing).toBe(config)
  })

  it('拖起来又放回原处就一步不动', () => {
    const config = configOf()
    const onto = movePrim(config, styleOf(config), 'a', {
      parentId: null,
      index: 0,
    })
    const after = movePrim(config, styleOf(config), 'a', {
      parentId: null,
      index: 1,
    })

    expect(onto).toBe(config)
    expect(after).toBe(config)
  })

  it('搬完再归一化不变形', () => {
    const config = configOf()
    const next = movePrim(config, styleOf(config), 'b', {
      parentId: 'a',
      index: 1,
    })

    expect(normalizeTwin2dConfig(next)).toEqual(next)
  })
})

describe('节点级追加图元', () => {
  it('新 id 要避开样式里那棵树', () => {
    const config = configOf()
    const added = addNodeLayer(
      config,
      'n1',
      styleOf(config),
      { kind: 'txt' },
      firstThen('a2x'),
    )

    expect(added.id).toBe('prim-2')
    expect(idsOf(layersOf(added.config))).toEqual(['prim-2'])
  })

  it('样式解析不到时也加得进去', () => {
    const config = configOf()
    const added = addNodeLayer(config, 'n1', null, { kind: 'vec' }, idSeq())

    expect(added.id).toBe('prim-1')
    expect(normalizeTwin2dConfig(added.config)).toEqual(added.config)
  })

  it('节点不在就原样返回入参那份配置', () => {
    const config = configOf()
    const added = addNodeLayer(
      config,
      '没有这个',
      null,
      { kind: 'txt' },
      idSeq(),
    )

    expect(added.id).toBeNull()
    expect(added.config).toBe(config)
  })

  it('换掉一枚追加图元；同层别的那些与别的节点都不动', () => {
    const config = configOf()
    const one = addNodeLayer(config, 'n1', null, { kind: 'txt' }, idSeq())
    const added = addNodeLayer(one.config, 'n1', null, { kind: 'vec' }, idSeq())
    const layer = layersOf(added.config).at(1)
    const next =
      layer === undefined
        ? added.config
        : updateNodeLayer(added.config, 'n1', { ...layer, opacity: 0.25 })
    const missing =
      layer === undefined
        ? added.config
        : updateNodeLayer(added.config, 'n1', { ...layer, id: '没有这个' })

    expect(layersOf(next).at(1)?.opacity).toBe(0.25)
    expect(layersOf(next).at(0)).toBe(layersOf(added.config).at(0))
    expect(next.nodes.at(1)).toBe(added.config.nodes.at(1))
    expect(missing).toBe(added.config)
  })

  it('删一枚追加图元；不在就原样返回', () => {
    const config = configOf()
    const added = addNodeLayer(config, 'n1', null, { kind: 'txt' }, idSeq())

    expect(layersOf(removeNodeLayer(added.config, 'n1', 'prim-1'))).toEqual([])
    expect(removeNodeLayer(added.config, 'n1', '没有这个')).toBe(added.config)
    expect(removeNodeLayer(added.config, '没有这个', 'prim-1')).toBe(
      added.config,
    )
  })
})

describe('节点级覆盖补丁', () => {
  it('整条写进去，再整条撤掉', () => {
    const config = configOf()
    const set = setNodePrimPatch(config, 'n1', 'a1', { hidden: true })
    const cleared = clearNodePrimPatch(set, 'n1', 'a1')

    expect(set.nodes.at(0)?.patch).toEqual({ a1: { hidden: true } })
    expect(cleared.nodes.at(0)?.patch).toEqual({})
    expect(normalizeTwin2dConfig(set)).toEqual(set)
  })

  it('撤掉一条不存在的覆盖就原样返回入参那份配置', () => {
    const config = configOf()

    expect(clearNodePrimPatch(config, 'n1', 'a1')).toBe(config)
    expect(setNodePrimPatch(config, '没有这个', 'a1', {})).toBe(config)
  })

  it('只撤掉点名的那一条，别的覆盖原样留着', () => {
    const config = configOf()
    const two = setNodePrimPatch(
      setNodePrimPatch(config, 'n1', 'a1', { hidden: true }),
      'n1',
      'b',
      { opacity: 0.5 },
    )
    const cleared = clearNodePrimPatch(two, 'n1', 'a1')

    expect(cleared.nodes.at(0)?.patch).toEqual({ b: { opacity: 0.5 } })
  })
})
