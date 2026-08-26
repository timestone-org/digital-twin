/**
 * @fileoverview 锁住「归一化整条丢掉了什么」那一族：被丢的节点 / 连线 / 标注 / 图元 /
 * 槽位 / 端口 / 变体、被截断的超深图元层，以及退成空档的 sprite。这一族只在**原始**
 * 文档上成立——归一化输出里那些条目已经不在了，拿它跑必然是空数组，末尾有一条用例
 * 专门钉住这一点。`at` 一律是原始下标，用户照着找得过去。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_MAX_PRIM_DEPTH } from '../src/constants'
import { collectTwin2dIssues } from '../src/issues'
import type { Twin2dIssue, Twin2dIssueCode } from '../src/issueTypes'
import { normalizeTwin2dConfig } from '../src/normalize'

function onlyCode(
  issues: readonly Twin2dIssue[],
  code: Twin2dIssueCode,
): Twin2dIssue[] {
  return issues.filter((issue) => issue.code === code)
}

/** 丢弃那一族全是 `dropped-*` 加超深与 sprite 两条。 */
function droppedOnly(issues: readonly Twin2dIssue[]): Twin2dIssue[] {
  return issues.filter(
    (issue) =>
      issue.code.startsWith('dropped-') ||
      issue.code === 'prim-too-deep' ||
      issue.code === 'dangling-sprite',
  )
}

/** 一棵指定层数的原始盒树，最外层是第 1 层；最里层的子表由 `leaf` 给。 */
function deepBox(
  depth: number,
  leaf: readonly unknown[] = [],
): Record<string, unknown> {
  return {
    id: `b${depth}`,
    kind: 'box',
    children: depth <= 1 ? leaf : [deepBox(depth - 1, leaf)],
  }
}

describe('dropped-node', () => {
  it('缺 id 与重复 id 分得开，各自说清是哪一种', () => {
    const raw = {
      nodes: [{ styleId: 'st' }, { id: 'n1' }, { id: 'n1', x: 10 }],
    }
    expect(onlyCode(collectTwin2dIssues(raw), 'dropped-node')).toEqual([
      {
        level: 'error',
        code: 'dropped-node',
        message: '这个节点没有可用的 id，整条会被丢掉',
        at: 'nodes[0]',
      },
      {
        level: 'error',
        code: 'dropped-node',
        message: '节点 id n1 与前面某个节点重复，后来的这条会被丢掉',
        at: 'nodes[2]',
      },
    ])
  })

  it('数组里混进来的非对象也算被丢掉的一条', () => {
    const raw = { nodes: ['n1', { id: 'n2' }] }
    expect(
      onlyCode(collectTwin2dIssues(raw), 'dropped-node').map((one) => one.at),
    ).toEqual(['nodes[0]'])
  })

  it('被丢掉的节点不再往里扫——整块都没了，报它内部的槽只是噪声', () => {
    const raw = { nodes: [{ slots: [{ label: '无 key' }] }] }
    expect(onlyCode(collectTwin2dIssues(raw), 'dropped-slot')).toEqual([])
  })
})

describe('dropped-edge', () => {
  it('端点指到不存在的节点时点名那个节点，起点先于终点', () => {
    const raw = {
      nodes: [{ id: 'n1', styleId: 'st' }],
      styles: [{ id: 'st' }],
      edges: [
        { id: 'e1', from: { nodeId: 'n-gone' }, to: { nodeId: 'n1' } },
        { id: 'e2', from: { nodeId: 'n1' }, to: { nodeId: 'n-also-gone' } },
      ],
    }
    expect(onlyCode(collectTwin2dIssues(raw), 'dropped-edge')).toEqual([
      {
        level: 'error',
        code: 'dropped-edge',
        message: '起点指向的节点 n-gone 不在文档里，整条连线会被丢掉',
        at: 'edges[0]',
      },
      {
        level: 'error',
        code: 'dropped-edge',
        message: '终点指向的节点 n-also-gone 不在文档里，整条连线会被丢掉',
        at: 'edges[1]',
      },
    ])
  })

  it('端点整个没写、连线缺 id、非对象三种各有各的说法', () => {
    const raw = {
      nodes: [{ id: 'n1', styleId: 'st' }],
      styles: [{ id: 'st' }],
      edges: [
        { id: 'e1', to: { nodeId: 'n1' } },
        { from: { nodeId: 'n1' }, to: { nodeId: 'n1' } },
        7,
      ],
    }
    expect(
      onlyCode(collectTwin2dIssues(raw), 'dropped-edge').map(
        (one) => one.message,
      ),
    ).toEqual([
      '起点没有指向任何节点，整条连线会被丢掉',
      '这条连线没有可用的 id，整条连线会被丢掉',
      '这一条不是一个对象，整条连线会被丢掉',
    ])
  })

  it('同 id 的第二条连线被丢掉', () => {
    const raw = {
      nodes: [{ id: 'n1', styleId: 'st' }],
      styles: [{ id: 'st' }],
      edges: [
        { id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n1' } },
        { id: 'e1', from: { nodeId: 'n1' }, to: { nodeId: 'n1' } },
      ],
    }
    expect(onlyCode(collectTwin2dIssues(raw), 'dropped-edge')).toEqual([
      {
        level: 'error',
        code: 'dropped-edge',
        message: '连线 id e1 与前面某条连线重复，后来的这条会被丢掉',
        at: 'edges[1]',
      },
    ])
  })
})

describe('dropped-mark', () => {
  it('缺 id、kind 认不出与重复 id 三种分得开', () => {
    const raw = {
      marks: [
        { kind: 'box' },
        { id: 'm1', kind: 'blob' },
        { id: 'm2', kind: 'text' },
        { id: 'm2', kind: 'line' },
        null,
      ],
    }
    expect(
      onlyCode(collectTwin2dIssues(raw), 'dropped-mark').map((one) => ({
        at: one.at,
        message: one.message,
      })),
    ).toEqual([
      { at: 'marks[0]', message: '这条标注没有可用的 id，整条会被丢掉' },
      {
        at: 'marks[1]',
        message: '这条标注的 kind 不在 rect / line / text 三档内，整条会被丢掉',
      },
      {
        at: 'marks[3]',
        message: '标注 id m2 与前面某条标注重复，后来的这条会被丢掉',
      },
      { at: 'marks[4]', message: '这条标注没有可用的 id，整条会被丢掉' },
    ])
  })
})

describe('dropped-prim', () => {
  it('缺 id、kind 认不出与同层重复三种分得开，路径带 children', () => {
    const raw = {
      styles: [
        {
          id: 'st',
          prims: [
            {
              id: '__root',
              kind: 'box',
              children: [{ kind: 'txt' }, { id: 'a', kind: 'blob' }],
            },
            { id: '__root', kind: 'box' },
          ],
        },
      ],
    }
    expect(onlyCode(collectTwin2dIssues(raw), 'dropped-prim')).toEqual([
      {
        level: 'error',
        code: 'dropped-prim',
        message: '图元 id __root 与同层前面的重复，后来的这一枝会被丢掉',
        at: 'styles[0].prims[1]',
      },
      {
        level: 'error',
        code: 'dropped-prim',
        message: '这个图元没有可用的 id，它连同子树会被丢掉',
        at: 'styles[0].prims[0].children[0]',
      },
      {
        level: 'error',
        code: 'dropped-prim',
        message:
          '这个图元的 kind 不在 box / vec / ico / txt 四档内，它连同子树会被丢掉',
        at: 'styles[0].prims[0].children[1]',
      },
    ])
  })

  it('节点追加的图元层也扫，路径落在 layers 上', () => {
    const raw = { nodes: [{ id: 'n1', styleId: 'st', layers: [{}] }] }
    expect(
      onlyCode(collectTwin2dIssues(raw), 'dropped-prim').map((one) => one.at),
    ).toEqual(['nodes[0].layers[0]'])
  })

  it('被丢掉的样式不再往里扫', () => {
    const raw = { styles: [{ prims: [{ kind: 'box' }] }] }
    expect(onlyCode(collectTwin2dIssues(raw), 'dropped-prim')).toEqual([])
  })
})

describe('prim-too-deep', () => {
  it('超过深度上限的那一层报出来，且只报那一层', () => {
    const raw = {
      styles: [{ id: 'st', prims: [deepBox(TWIN_2D_MAX_PRIM_DEPTH + 2)] }],
    }
    const children = '.children[0]'.repeat(TWIN_2D_MAX_PRIM_DEPTH)
    expect(onlyCode(collectTwin2dIssues(raw), 'prim-too-deep')).toEqual([
      {
        level: 'error',
        code: 'prim-too-deep',
        message: `图元树深度超过上限 ${TWIN_2D_MAX_PRIM_DEPTH}，这一层连同它的子树会被截断丢掉`,
        at: `styles[0].prims[0]${children}`,
      },
    ])
  })

  it('正好到深度上限的树不报', () => {
    const raw = {
      styles: [{ id: 'st', prims: [deepBox(TWIN_2D_MAX_PRIM_DEPTH)] }],
    }
    expect(collectTwin2dIssues(raw)).toEqual([])
  })

  it('超深那一层里的图元再脏也只报截断，不叠一条 dropped-prim', () => {
    const raw = {
      styles: [
        {
          id: 'st',
          prims: [deepBox(TWIN_2D_MAX_PRIM_DEPTH, [{ kind: 'box' }])],
        },
      ],
    }
    const children = '.children[0]'.repeat(TWIN_2D_MAX_PRIM_DEPTH)
    expect(collectTwin2dIssues(raw)).toEqual([
      {
        level: 'error',
        code: 'prim-too-deep',
        message: `图元树深度超过上限 ${TWIN_2D_MAX_PRIM_DEPTH}，这一层连同它的子树会被截断丢掉`,
        at: `styles[0].prims[0]${children}`,
      },
    ])
  })
})

describe('dangling-sprite', () => {
  it('名单外的 sprite id 报出来，没写 id 的另有一句', () => {
    const raw = {
      nodes: [
        {
          id: 'n1',
          styleId: 'st',
          layers: [
            { id: 'i0', kind: 'ico', src: { kind: 'sprite', id: 'ico-nope' } },
            { id: 'i1', kind: 'ico', src: { kind: 'sprite' } },
          ],
        },
      ],
      styles: [{ id: 'st' }],
    }
    expect(onlyCode(collectTwin2dIssues(raw), 'dangling-sprite')).toEqual([
      {
        level: 'error',
        code: 'dangling-sprite',
        message: '内置图标集里没有 ico-nope，这个图标会整个消失',
        at: 'nodes[0].layers[0].src.id',
      },
      {
        level: 'error',
        code: 'dangling-sprite',
        message: '这枚图标没写 sprite id，图标会整个消失',
        at: 'nodes[0].layers[1].src.id',
      },
    ])
  })

  it('名单里的 sprite、其它图标来源、没写 src 的图标与非图标都不报', () => {
    const raw = {
      styles: [
        {
          id: 'st',
          prims: [
            { id: 'i0', kind: 'ico', src: { kind: 'sprite', id: 'ico-hx' } },
            { id: 'i1', kind: 'ico', src: { kind: 'name', name: 'pump' } },
            { id: 'i2', kind: 'ico' },
            { id: 't0', kind: 'txt' },
          ],
        },
      ],
    }
    expect(collectTwin2dIssues(raw)).toEqual([])
  })
})

describe('dropped-slot 与 dropped-port', () => {
  it('样式里缺 key / 重复 key 的槽位与缺 id / 重复 id 的端口都报出来', () => {
    const raw = {
      styles: [
        {
          id: 'st',
          slots: [{ label: '没 key' }, { key: 's1' }, { key: 's1' }],
          ports: [{ name: '没 id' }, { id: 'p1' }, { id: 'p1' }],
        },
      ],
    }
    const issues = collectTwin2dIssues(raw)
    expect(onlyCode(issues, 'dropped-slot')).toEqual([
      {
        level: 'error',
        code: 'dropped-slot',
        message: '这个槽位没有可用的 key，整条会被丢掉',
        at: 'styles[0].slots[0]',
      },
      {
        level: 'error',
        code: 'dropped-slot',
        message: '槽位 key s1 与前面某个槽位重复，后来的这条会被丢掉',
        at: 'styles[0].slots[2]',
      },
    ])
    expect(onlyCode(issues, 'dropped-port')).toEqual([
      {
        level: 'error',
        code: 'dropped-port',
        message: '这个端口没有可用的 id，整条会被丢掉',
        at: 'styles[0].ports[0]',
      },
      {
        level: 'error',
        code: 'dropped-port',
        message: '端口 id p1 与前面某个端口重复，后来的这条会被丢掉',
        at: 'styles[0].ports[2]',
      },
    ])
  })

  it('节点自己追加的槽位与端口同样扫，路径落在 nodes 上', () => {
    const raw = {
      styles: [{ id: 'st' }],
      nodes: [{ id: 'n1', styleId: 'st', slots: [{}], ports: [{}] }],
    }
    expect(collectTwin2dIssues(raw).map((one) => one.at)).toEqual([
      'nodes[0].slots[0]',
      'nodes[0].ports[0]',
    ])
  })
})

describe('dropped-variant', () => {
  it('缺 id、条件不合法与重复 id 三种分得开', () => {
    const raw = {
      styles: [
        {
          id: 'st',
          variants: [
            { when: { kind: 'state', state: 'hover' } },
            { id: 'v1', when: { kind: 'nope' } },
            { id: 'v2', when: { kind: 'state', state: 'hover' } },
            { id: 'v2', when: { kind: 'state', state: 'active' } },
          ],
        },
      ],
    }
    expect(
      onlyCode(collectTwin2dIssues(raw), 'dropped-variant').map((one) => ({
        at: one.at,
        message: one.message,
      })),
    ).toEqual([
      {
        at: 'styles[0].variants[0]',
        message: '这条变体没有可用的 id，整条会被丢掉',
      },
      {
        at: 'styles[0].variants[1]',
        message: '这条变体的触发条件不合法，整条会被丢掉',
      },
      {
        at: 'styles[0].variants[3]',
        message: '变体 id v2 与前面某条变体重复，后来的这条会被丢掉',
      },
    ])
  })
})

describe('丢弃那一族只在原始文档上有意义', () => {
  it('把归一化输出再喂一遍，丢弃那一族一条都不剩', () => {
    const raw = {
      styles: [
        {
          id: 'st',
          prims: [{ kind: 'box' }, deepBox(TWIN_2D_MAX_PRIM_DEPTH + 2)],
          slots: [{ label: '没 key' }],
          ports: [{ name: '没 id' }],
          variants: [{ id: 'v1', when: { kind: 'nope' } }],
        },
      ],
      nodes: [
        { styleId: 'st' },
        {
          id: 'n1',
          styleId: 'st',
          layers: [
            { id: 'i0', kind: 'ico', src: { kind: 'sprite', id: 'ico-nope' } },
          ],
        },
      ],
      edges: [{ id: 'e1', from: { nodeId: 'n-gone' }, to: { nodeId: 'n1' } }],
      marks: [{ id: 'm1', kind: 'blob' }],
    }
    const codes = droppedOnly(collectTwin2dIssues(raw)).map((one) => one.code)
    expect(codes).toEqual([
      'dropped-node',
      'dropped-edge',
      'dropped-mark',
      'dropped-prim',
      'prim-too-deep',
      'dropped-slot',
      'dropped-port',
      'dropped-variant',
      'dangling-sprite',
    ])
    const cleaned = normalizeTwin2dConfig(raw)
    expect(droppedOnly(collectTwin2dIssues(cleaned))).toEqual([])
  })
})
