/**
 * @fileoverview 契约：剪贴板打包/粘贴全是纯函数，粘出来的东西一律换新 id；复制一批
 * 节点只带走两端都在这一批里的连线；跨图粘贴时用到的文档级样式跟着走，同 id 沿用目标
 * 图那份，仍然寻不到的如实报缺。
 *
 * ⚠ 悬空连线粘出来会被归一化整条丢掉，用户看到的是「连线没了」，所以「哪些线跟着走」
 * 与「哪些线粘不上」两头都要钉住。
 * ⚠ 只带连线的那一份必须经得起 localStorage 往返：少了端点 id 就会在读回来时被整批
 * 悬空过滤掉，而那只在刷新页面之后才发作。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
  TWIN_2D_EDGE_PRESETS,
  normalizePrims,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dConfig, Twin2dPrim } from '@dt/twin2d'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TWIN_2D_CLIPBOARD_KEY,
  createTwin2dClipboard,
  parseTwin2dClip,
  pasteTwin2dEntities,
  pasteTwin2dPrims,
  twin2dCut,
  twin2dEntityClip,
  twin2dPrimClip,
} from '@/pages/Twin2dEditor/scripts/clipboard'
import type { Twin2dEntityClip } from '@/pages/Twin2dEditor/scripts/clipboard'
import { twin2dPrimIds } from '@/pages/Twin2dEditor/scripts/primOps'

/** 造 id 的桩：按调用次序发号，用例才断言得出具体的 id。 */
function idSeries(prefix: string): () => string {
  let seq = 0
  return () => {
    seq += 1
    return `${prefix}${seq}`
  }
}

/** 固定时刻的钟，免得用例之间靠真实时间比新旧。 */
function clockAt(value: number): () => number {
  return () => value
}

/** 三个节点、两条线、一条标注，节点样式与连线样式都在文档里。 */
function makeConfig(): Twin2dConfig {
  return normalizeTwin2dConfig({
    styles: [{ id: 'sty', name: '本图样式', size: { w: 40, h: 20 } }],
    edgeStyles: [{ id: 'wire', name: '本图线' }],
    nodes: [
      { id: 'a', styleId: 'sty', x: 0, y: 0 },
      { id: 'b', styleId: 'sty', x: 100, y: 0 },
      { id: 'c', styleId: 'sty', x: 200, y: 0 },
    ],
    edges: [
      {
        id: 'ab',
        styleId: 'wire',
        from: { nodeId: 'a' },
        to: { nodeId: 'b' },
        waypoints: [{ x: 50, y: 10 }],
      },
      { id: 'bc', styleId: 'wire', from: { nodeId: 'b' }, to: { nodeId: 'c' } },
    ],
    marks: [{ id: 'm1', kind: 'line', x: 0, y: 0, x2: 30, y2: 40 }],
  })
}

/** 一张空图，用来演「跨图粘贴」。 */
function emptyConfig(): Twin2dConfig {
  return normalizeTwin2dConfig({})
}

const NO_MOVE = { x: 0, y: 0 }

/** 预置库里第一个节点样式的 id。 */
const BUILTIN_STYLE_ID = [...TWIN_2D_BUILTIN_NODE_STYLE_MAP.keys()][0] ?? ''

/** 预置库里第一个连线样式的 id。 */
const BUILTIN_EDGE_STYLE_ID = TWIN_2D_EDGE_PRESETS[0]?.id ?? ''

function clipOf(
  config: Twin2dConfig,
  kind: 'nodes' | 'edges' | 'marks',
  ids: readonly string[],
): Twin2dEntityClip {
  const clip = twin2dEntityClip(config, kind, ids, clockAt(1))
  if (clip === null) throw new Error('这一批本该打得出载荷')
  return clip
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('打实体载荷', () => {
  it('复制一批节点只带走两端都在这一批里的连线', () => {
    const clip = clipOf(makeConfig(), 'nodes', ['a', 'b'])

    expect(clip.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(clip.edges.map((edge) => edge.id)).toEqual(['ab'])
  })

  it('一条都没选中时不打载荷', () => {
    expect(twin2dEntityClip(makeConfig(), 'nodes', [])).toBeNull()
    expect(twin2dEntityClip(makeConfig(), 'nodes', ['无此节点'])).toBeNull()
  })

  it('载荷带走这批节点用到的文档级样式', () => {
    const clip = clipOf(makeConfig(), 'nodes', ['a'])

    expect(clip.styles.map((style) => style.id)).toEqual(['sty'])
  })

  it('预置库里的样式不进载荷', () => {
    const config = normalizeTwin2dConfig({
      styles: [{ id: 'sty', size: { w: 40, h: 20 } }],
      nodes: [{ id: 'a', styleId: BUILTIN_STYLE_ID, x: 0, y: 0 }],
    })

    const clip = clipOf(config, 'nodes', ['a'])

    expect(clip.styles).toEqual([])
  })

  it('只选连线时不带节点，两端点到谁记在载荷里', () => {
    const clip = clipOf(makeConfig(), 'edges', ['ab'])

    expect(clip.nodes).toEqual([])
    expect([...clip.edgeNodeIds].sort()).toEqual(['a', 'b'])
    expect(clip.edgeStyles.map((style) => style.id)).toEqual(['wire'])
  })

  it('只选标注时三类里只有标注', () => {
    const clip = clipOf(makeConfig(), 'marks', ['m1'])

    expect(clip.marks.map((mark) => mark.id)).toEqual(['m1'])
    expect(clip.nodes).toEqual([])
    expect(clip.edges).toEqual([])
  })
})

describe('粘贴实体', () => {
  it('副本一律换新 id，原件原样留在图上', () => {
    const config = makeConfig()
    const pasted = pasteTwin2dEntities({
      config,
      clip: clipOf(config, 'nodes', ['a', 'b']),
      offset: { x: 8, y: 4 },
      makeId: idSeries('fresh'),
    })

    expect(pasted.ids.nodes).toEqual(['fresh1', 'fresh2'])
    expect(pasted.config.nodes.map((node) => node.id)).toEqual([
      'a',
      'b',
      'c',
      'fresh1',
      'fresh2',
    ])
    expect(pasted.config.nodes[0]?.x).toBe(0)
  })

  it('副本按位移落位，标注的辅助线第二端跟着挪', () => {
    const config = makeConfig()
    const pasted = pasteTwin2dEntities({
      config,
      clip: clipOf(config, 'marks', ['m1']),
      offset: { x: 8, y: 4 },
      makeId: idSeries('fresh'),
    })
    const copy = pasted.config.marks.find((mark) => mark.id === 'fresh1')

    expect(copy?.x).toBe(8)
    expect(copy?.y).toBe(4)
    expect(copy?.x2).toBe(38)
    expect(copy?.y2).toBe(44)
  })

  it('两端都跟着粘的连线接到副本上，拐点跟着加位移', () => {
    const config = makeConfig()
    const pasted = pasteTwin2dEntities({
      config,
      clip: clipOf(config, 'nodes', ['a', 'b']),
      offset: { x: 8, y: 4 },
      makeId: idSeries('fresh'),
    })
    const copy = pasted.config.edges.find((edge) => edge.id === 'fresh3')

    expect(copy?.from.nodeId).toBe('fresh1')
    expect(copy?.to.nodeId).toBe('fresh2')
    expect(copy?.waypoints).toEqual([{ x: 58, y: 14 }])
    expect(pasted.droppedEdges).toBe(0)
  })

  it('只粘连线时两端仍挂原节点，拐点一步不动', () => {
    const config = makeConfig()
    const pasted = pasteTwin2dEntities({
      config,
      clip: clipOf(config, 'edges', ['ab']),
      offset: { x: 8, y: 4 },
      makeId: idSeries('fresh'),
    })
    const copy = pasted.config.edges.find((edge) => edge.id === 'fresh1')

    expect(copy?.from.nodeId).toBe('a')
    expect(copy?.to.nodeId).toBe('b')
    expect(copy?.waypoints).toEqual([{ x: 50, y: 10 }])
  })

  it('两端在本图里都寻不到的连线整条不粘并计数', () => {
    const clip = clipOf(makeConfig(), 'edges', ['ab'])
    const pasted = pasteTwin2dEntities({
      config: emptyConfig(),
      clip,
      offset: NO_MOVE,
      makeId: idSeries('fresh'),
    })

    expect(pasted.droppedEdges).toBe(1)
    expect(pasted.config.edges).toEqual([])
    expect(pasted.ids.edges).toEqual([])
  })

  it('没粘上的那条线的样式不并进本图', () => {
    const clip = clipOf(makeConfig(), 'edges', ['ab'])
    const pasted = pasteTwin2dEntities({
      config: emptyConfig(),
      clip,
      offset: NO_MOVE,
      makeId: idSeries('fresh'),
    })

    expect(pasted.edgeStyles.added).toEqual([])
    expect(pasted.config.edgeStyles).toEqual([])
  })

  it('不给 id 工厂时也发得出不重名的 id', () => {
    const config = makeConfig()
    const pasted = pasteTwin2dEntities({
      config,
      clip: clipOf(config, 'nodes', ['a']),
      offset: NO_MOVE,
    })
    const fresh = pasted.ids.nodes[0] ?? ''

    expect(fresh.startsWith('node-')).toBe(true)
    expect(config.nodes.some((node) => node.id === fresh)).toBe(false)
  })
})

describe('跨图粘贴带样式', () => {
  it('本图没有的样式跟着载荷补进来', () => {
    const clip = clipOf(makeConfig(), 'nodes', ['a'])
    const pasted = pasteTwin2dEntities({
      config: emptyConfig(),
      clip,
      offset: NO_MOVE,
      makeId: idSeries('fresh'),
    })

    expect(pasted.styles.added).toEqual(['sty'])
    expect(pasted.styles.missing).toEqual([])
    expect(pasted.config.styles.map((style) => style.id)).toEqual(['sty'])
  })

  it('本图已有同 id 样式时沿用本图那份，不覆盖', () => {
    const clip = clipOf(makeConfig(), 'nodes', ['a'])
    const target = normalizeTwin2dConfig({
      styles: [{ id: 'sty', name: '目标图样式', size: { w: 90, h: 90 } }],
    })

    const pasted = pasteTwin2dEntities({
      config: target,
      clip,
      offset: NO_MOVE,
      makeId: idSeries('fresh'),
    })

    expect(pasted.styles.adopted).toEqual(['sty'])
    expect(pasted.styles.added).toEqual([])
    expect(pasted.config.styles[0]?.name).toBe('目标图样式')
    expect(pasted.config.styles[0]?.size).toEqual({ w: 90, h: 90 })
  })

  it('预置库里的样式不补进本图也不算缺', () => {
    const source = normalizeTwin2dConfig({
      nodes: [{ id: 'a', styleId: BUILTIN_STYLE_ID, x: 0, y: 0 }],
    })
    const pasted = pasteTwin2dEntities({
      config: emptyConfig(),
      clip: clipOf(source, 'nodes', ['a']),
      offset: NO_MOVE,
      makeId: idSeries('fresh'),
    })

    expect(pasted.styles.added).toEqual([])
    expect(pasted.styles.missing).toEqual([])
  })

  it('本图、载荷、预置库里都没有的样式如实报缺', () => {
    const source = normalizeTwin2dConfig({
      nodes: [{ id: 'a', styleId: '查无此样式', x: 0, y: 0 }],
    })
    const pasted = pasteTwin2dEntities({
      config: emptyConfig(),
      clip: clipOf(source, 'nodes', ['a']),
      offset: NO_MOVE,
      makeId: idSeries('fresh'),
    })

    expect(pasted.styles.missing).toEqual(['查无此样式'])
    expect(pasted.ids.nodes).toEqual(['fresh1'])
  })

  it('预置库里的连线样式不补进本图', () => {
    const source = normalizeTwin2dConfig({
      nodes: [
        { id: 'a', styleId: 'sty', x: 0, y: 0 },
        { id: 'b', styleId: 'sty', x: 60, y: 0 },
      ],
      edges: [
        {
          id: 'ab',
          styleId: BUILTIN_EDGE_STYLE_ID,
          from: { nodeId: 'a' },
          to: { nodeId: 'b' },
        },
      ],
    })
    const pasted = pasteTwin2dEntities({
      config: emptyConfig(),
      clip: clipOf(source, 'nodes', ['a', 'b']),
      offset: NO_MOVE,
      makeId: idSeries('fresh'),
    })

    expect(pasted.edgeStyles.added).toEqual([])
    expect(pasted.edgeStyles.missing).toEqual([])
  })
})

describe('剪切', () => {
  it('先打载荷再删：被级联带走的连线仍在载荷里', () => {
    const cut = twin2dCut(makeConfig(), 'nodes', ['a', 'b'], clockAt(1))

    expect(cut.clip?.edges.map((edge) => edge.id)).toEqual(['ab'])
    expect(cut.removal.removed.nodes).toEqual(['a', 'b'])
    expect([...cut.removal.removed.edges].sort()).toEqual(['ab', 'bc'])
  })

  it('剪切标注只删标注', () => {
    const cut = twin2dCut(makeConfig(), 'marks', ['m1'], clockAt(1))

    expect(cut.clip?.marks.map((mark) => mark.id)).toEqual(['m1'])
    expect(cut.removal.config.marks).toEqual([])
    expect(cut.removal.config.nodes).toHaveLength(3)
  })

  it('点名的实体一个都不在时，载荷为空且一步没删', () => {
    const config = makeConfig()
    const cut = twin2dCut(config, 'edges', ['无此连线'], clockAt(1))

    expect(cut.clip).toBeNull()
    expect(cut.removal.config).toBe(config)
  })
})

describe('图元', () => {
  /** 一棵两层的图元树。 */
  function primTree(): readonly Twin2dPrim[] {
    return normalizePrims(
      [
        {
          id: 'box',
          kind: 'box',
          children: [
            { id: 'inner', kind: 'txt' },
            {
              id: 'deep',
              kind: 'box',
              children: [{ id: 'leaf', kind: 'ico' }],
            },
          ],
        },
      ],
      0,
    )
  }

  it('收 id 时各层子树一并收齐', () => {
    expect([...twin2dPrimIds(primTree())].sort()).toEqual([
      'box',
      'deep',
      'inner',
      'leaf',
    ])
  })

  it('一个图元都没给时不打载荷', () => {
    expect(twin2dPrimClip([], clockAt(1))).toBeNull()
  })

  it('粘贴时整棵子树逐层重发 id', () => {
    const tree = primTree()
    const clip = twin2dPrimClip(tree, clockAt(1))
    if (clip === null) throw new Error('这一批本该打得出载荷')

    const pasted = pasteTwin2dPrims({
      list: tree,
      clip,
      taken: twin2dPrimIds(tree),
      makeId: idSeries('p'),
    })
    const ids = twin2dPrimIds(pasted.list)

    expect(pasted.ids).toEqual(['p1'])
    expect(pasted.list).toHaveLength(2)
    expect([...ids].sort()).toEqual([
      'box',
      'deep',
      'inner',
      'leaf',
      'p1',
      'p2',
      'p3',
      'p4',
    ])
  })

  it('载荷里一个图元都没有时，目标表原样返回', () => {
    const list = primTree()
    const pasted = pasteTwin2dPrims({
      list,
      clip: { kind: 'prims', version: 1, stampMs: 1, prims: [] },
      taken: twin2dPrimIds(list),
    })

    expect(pasted.list).toBe(list)
    expect(pasted.ids).toEqual([])
  })

  it('不给 id 工厂时也发得出不重名的图元 id', () => {
    const tree = primTree()
    const clip = twin2dPrimClip(tree, clockAt(1))
    if (clip === null) throw new Error('这一批本该打得出载荷')

    const pasted = pasteTwin2dPrims({
      list: tree,
      clip,
      taken: twin2dPrimIds(tree),
    })

    expect(pasted.ids[0]?.startsWith('prim-')).toBe(true)
  })
})

describe('剪贴板两个通道', () => {
  it('写完读回同一份', () => {
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)
    const clip = clipOf(makeConfig(), 'nodes', ['a'])

    board.write(clip)

    expect(board.read()).toBe(clip)
  })

  it('localStorage 里更新的那份压过内存里的', () => {
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)
    board.write(clipOf(makeConfig(), 'nodes', ['a']))

    const outside = twin2dEntityClip(makeConfig(), 'marks', ['m1'], clockAt(99))
    localStorage.setItem(TWIN_2D_CLIPBOARD_KEY, JSON.stringify(outside))

    expect(board.read()?.kind).toBe('entities')
    expect((board.read() as Twin2dEntityClip).marks).toHaveLength(1)
  })

  it('内存里更新的那份压过 localStorage 里的', () => {
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)
    const stale = twin2dEntityClip(makeConfig(), 'marks', ['m1'], clockAt(1))
    localStorage.setItem(TWIN_2D_CLIPBOARD_KEY, JSON.stringify(stale))

    const mine = twin2dEntityClip(makeConfig(), 'nodes', ['a'], clockAt(99))
    if (mine === null) throw new Error('这一批本该打得出载荷')
    board.write(mine)

    expect(board.read()).toBe(mine)
  })

  it('只带连线的一份经 localStorage 往返仍在', () => {
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)
    board.write(clipOf(makeConfig(), 'edges', ['ab']))

    const other = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)
    const back = other.read()

    expect(back?.kind).toBe('entities')
    expect((back as Twin2dEntityClip).edges.map((edge) => edge.id)).toEqual([
      'ab',
    ])
  })

  it('换上新的一份时粘贴位移归零，随后逐格累加', () => {
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)
    board.write(clipOf(makeConfig(), 'nodes', ['a']))

    expect(board.nextOffset(10)).toEqual({ x: 10, y: 10 })
    expect(board.nextOffset(10)).toEqual({ x: 20, y: 20 })

    board.write(clipOf(makeConfig(), 'nodes', ['b']))

    expect(board.nextOffset(10)).toEqual({ x: 10, y: 10 })
  })

  it('不给步长时按缺省栅格走', () => {
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)

    expect(board.nextOffset()).toEqual({ x: 20, y: 20 })
  })

  it('一次都没写过时读出来是空', () => {
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)

    expect(board.read()).toBeNull()
  })

  it('localStorage 写不进去时内存通道仍然可用', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('配额满')
    })
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)
    const clip = clipOf(makeConfig(), 'nodes', ['a'])

    board.write(clip)

    expect(board.read()).toBe(clip)
  })

  it('localStorage 读不出来时当没有', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('拿不到')
    })
    const board = createTwin2dClipboard(TWIN_2D_CLIPBOARD_KEY)

    expect(board.read()).toBeNull()
  })
})

describe('载荷的脏数据防御', () => {
  it('版本不符的一份当没有', () => {
    const clip = clipOf(makeConfig(), 'nodes', ['a'])

    expect(parseTwin2dClip({ ...clip, version: 99 })).toBeNull()
  })

  it('不是对象、缺时刻、时刻不是有限数的一份当没有', () => {
    const clip = clipOf(makeConfig(), 'nodes', ['a'])

    expect(parseTwin2dClip('一串字')).toBeNull()
    expect(parseTwin2dClip({ ...clip, stampMs: '刚才' })).toBeNull()
    expect(parseTwin2dClip({ ...clip, stampMs: Number.NaN })).toBeNull()
  })

  it('认不出装的是哪一类时当没有', () => {
    const clip = clipOf(makeConfig(), 'nodes', ['a'])

    expect(parseTwin2dClip({ ...clip, kind: '别的' })).toBeNull()
  })

  it('三类实例全空的一份当没有', () => {
    const clip = clipOf(makeConfig(), 'nodes', ['a'])

    expect(
      parseTwin2dClip({ ...clip, nodes: [], edges: [], marks: [] }),
    ).toBeNull()
  })

  it('图元全被丢掉的一份当没有', () => {
    const clip = twin2dPrimClip(
      normalizePrims([{ id: 'p', kind: 'box' }], 0),
      clockAt(1),
    )

    expect(parseTwin2dClip({ ...clip, prims: [{ kind: 'box' }] })).toBeNull()
  })

  it('往返一趟之后图元载荷仍是原样', () => {
    const prims = normalizePrims([{ id: 'p', kind: 'box' }], 0)
    const clip = twin2dPrimClip(prims, clockAt(7))

    const back = parseTwin2dClip(JSON.parse(JSON.stringify(clip)))

    expect(back).toEqual(clip)
  })
})
