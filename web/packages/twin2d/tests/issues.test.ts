/**
 * @fileoverview 锁住诊断入口与「引用完整性」那一族：悬空的样式 / 端口 / 槽 / 图元 id /
 * 渐变，加上画布外的拐点。入口吃的是原始 JSON、自己归一化一趟，所以这一族判的始终是
 * 归一化之后仍在的东西。五样都不会让渲染报错——一个让节点落到兜底样式，一个让线接到
 * 别处，其余几个让配好的东西安静地不出现。丢弃那一族在 issuesDropped.test.ts。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_ISSUE_CODES, TWIN_2D_ISSUE_LEVELS } from '../src/issueTypes'
import type { Twin2dIssue, Twin2dIssueCode } from '../src/issueTypes'
import { collectTwin2dIssues } from '../src/issues'
import type {
  Twin2dBoxPrim,
  Twin2dCondition,
  Twin2dExpr,
  Twin2dGradient,
  Twin2dIcoPrim,
  Twin2dIcoSrc,
  Twin2dPaint,
  Twin2dPrim,
  Twin2dPrimBase,
  Twin2dTxtPrim,
  Twin2dTxtSrc,
  Twin2dVecPrim,
} from '../src/typesPrim'
import type {
  Twin2dCanvas,
  Twin2dConfig,
  Twin2dEdge,
  Twin2dNode,
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dSlot,
} from '../src/types'

function canvasOf(): Twin2dCanvas {
  return {
    width: 1000,
    height: 800,
    grid: 20,
    showGrid: true,
    background: '',
    backgroundFit: 'cover',
    pattern: 'none',
    patternColor: '',
    patternGap: 24,
    patternWidth: 1,
  }
}

function configOf(patch: Partial<Twin2dConfig>): Twin2dConfig {
  return {
    version: 1,
    canvas: canvasOf(),
    styles: [],
    edgeStyles: [],
    nodes: [],
    edges: [],
    marks: [],
    ...patch,
  }
}

function primBase(id: string): Twin2dPrimBase {
  return {
    id,
    at: { kind: 'flow' },
    size: { w: 'auto', h: 'auto' },
    minWidth: null,
    maxWidth: null,
    z: 0,
    opacity: 1,
    hidden: false,
    when: null,
    anim: null,
    transition: null,
    rotate: 0,
    transformOrigin: 'center',
    pointerEvents: 'auto',
    keepUpright: false,
  }
}

function boxPrim(id: string, children: readonly Twin2dPrim[]): Twin2dBoxPrim {
  return {
    ...primBase(id),
    kind: 'box',
    layout: {
      flow: 'row',
      gap: 0,
      align: 'center',
      justify: 'center',
      wrap: false,
      pad: [0, 0, 0, 0],
    },
    fills: [],
    border: {
      width: 0,
      style: 'none',
      color: '',
      sides: { top: true, right: true, bottom: true, left: true },
    },
    radius: 0,
    shadows: [],
    backdropBlur: 0,
    clip: false,
    cursor: 'default',
    children,
  }
}

function txtPrim(id: string, src: Twin2dTxtSrc): Twin2dTxtPrim {
  return {
    ...primBase(id),
    kind: 'txt',
    src,
    font: {},
    align: 'start',
    baseline: 'auto',
    nowrap: false,
    ellipsis: false,
    titleAttr: false,
    shadows: [],
    outline: null,
  }
}

function icoPrim(id: string, src: Twin2dIcoSrc): Twin2dIcoPrim {
  return { ...primBase(id), kind: 'ico', src, color: 'currentColor' }
}

function vecPrim(
  id: string,
  fill: Twin2dPaint,
  gradients: readonly Twin2dGradient[],
): Twin2dVecPrim {
  return {
    ...primBase(id),
    kind: 'vec',
    coord: 'unit',
    shape: { kind: 'rect', x: 0, y: 0, w: 1, h: 1, rx: 0 },
    fill,
    strokes: [],
    gradients,
    stretch: false,
  }
}

function gradientOf(id: string): Twin2dGradient {
  return { kind: 'linear', id, x1: 0, y1: 0, x2: 1, y2: 0, stops: [] }
}

function slotOf(key: string, expr: Twin2dExpr | null): Twin2dSlot {
  return {
    key,
    label: key,
    kind: expr === null ? 'live' : 'derived',
    dataType: 'number',
    unit: '',
    precision: null,
    enumMap: {},
    placeholder: '—',
    primary: false,
    expr,
  }
}

function portOf(id: string): Twin2dPort {
  return {
    id,
    name: id,
    at: { kind: 'perim', t: 0 },
    dir: 'both',
    side: 'auto',
    showName: false,
    marker: null,
  }
}

function styleWith(patch: Partial<Twin2dNodeStyle>): Twin2dNodeStyle {
  return {
    id: 'st',
    name: '样式',
    category: '',
    accent: '',
    defaultStatus: 'online',
    size: { w: 100, h: 60 },
    prims: [],
    ports: [],
    slots: [],
    variants: [],
    ...patch,
  }
}

function nodeWith(patch: Partial<Twin2dNode>): Twin2dNode {
  return {
    id: 'n1',
    styleId: 'st',
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    rotate: 0,
    flipX: false,
    flipY: false,
    label: '',
    labelPos: 'bottom',
    status: '',
    accent: '',
    badge: '',
    badgeColor: '',
    badgeShape: 'round',
    tags: {},
    slots: [],
    layers: [],
    patch: {},
    ports: [],
    ...patch,
  }
}

function edgeWith(patch: Partial<Twin2dEdge>): Twin2dEdge {
  return {
    id: 'e1',
    styleId: 'es',
    from: { nodeId: 'n1', portId: '', t: null },
    to: { nodeId: 'n2', portId: '', t: null },
    route: 'auto',
    waypoints: [],
    accent: '',
    label: '',
    labelAt: 0.5,
    ...patch,
  }
}

function codesOf(issues: readonly Twin2dIssue[]): Twin2dIssueCode[] {
  return issues.map((issue) => issue.code)
}

function onlyCode(
  issues: readonly Twin2dIssue[],
  code: Twin2dIssueCode,
): Twin2dIssue[] {
  return issues.filter((issue) => issue.code === code)
}

describe('collectTwin2dIssues', () => {
  it('样式、端口、槽、补丁、渐变都对得上的配置一条问题都没有', () => {
    const style = styleWith({
      id: 'st',
      prims: [
        boxPrim('__root', [
          txtPrim('__reading', { kind: 'slot', slot: 'temp' }),
        ]),
      ],
      ports: [portOf('p1')],
      slots: [slotOf('temp', null)],
    })
    const config = configOf({
      styles: [style],
      nodes: [
        nodeWith({ id: 'n1', patch: { __root: { z: 2 } } }),
        nodeWith({ id: 'n2' }),
      ],
      edges: [
        edgeWith({
          from: { nodeId: 'n1', portId: 'p1', t: null },
          to: { nodeId: 'n2', portId: 'p1', t: null },
          waypoints: [{ x: 10, y: 10 }],
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([])
  })

  it('节点引到一个既不在文档也不在预置库里的样式时报出来', () => {
    const config = configOf({ nodes: [nodeWith({ styleId: 'st-gone' })] })
    expect(collectTwin2dIssues(config)).toEqual([
      {
        level: 'error',
        code: 'dangling-style',
        message: '找不到节点样式 st-gone，这个节点会落到 __fallback 兜底样式',
        at: 'nodes[0].styleId',
      },
    ])
  })

  it('样式只在预置库里时不算悬空——预置库靠参数注入', () => {
    const config = configOf({ nodes: [nodeWith({ styleId: 'preset-tank' })] })
    expect(
      collectTwin2dIssues(config, { knownStyleIds: new Set(['preset-tank']) }),
    ).toEqual([])
  })

  it('连线两端各自指到不存在的端口时分别报出来', () => {
    const config = configOf({
      styles: [styleWith({ ports: [portOf('p1')] })],
      nodes: [nodeWith({ id: 'n1' }), nodeWith({ id: 'n2' })],
      edges: [
        edgeWith({
          from: { nodeId: 'n1', portId: 'p-gone', t: null },
          to: { nodeId: 'n2', portId: 'p-also-gone', t: null },
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([
      {
        level: 'error',
        code: 'dangling-port',
        message: '节点 n1 上没有端口 p-gone，这一端会退回朝向对方中心',
        at: 'edges[0].from.portId',
      },
      {
        level: 'error',
        code: 'dangling-port',
        message: '节点 n2 上没有端口 p-also-gone，这一端会退回朝向对方中心',
        at: 'edges[0].to.portId',
      },
    ])
  })

  it('端口在节点自己追加的 ports 里也算数', () => {
    const config = configOf({
      styles: [styleWith({ ports: [] })],
      nodes: [nodeWith({ id: 'n1', ports: [portOf('p-extra')] })],
      edges: [
        edgeWith({
          from: { nodeId: 'n1', portId: 'p-extra', t: null },
          to: { nodeId: 'n1', portId: '', t: null },
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([])
  })

  it('样式本身就找不到时不再叠一条端口问题', () => {
    const config = configOf({
      nodes: [nodeWith({ id: 'n1', styleId: 'st-gone' })],
      edges: [
        edgeWith({
          from: { nodeId: 'n1', portId: 'p1', t: null },
          to: { nodeId: 'n1', portId: '', t: null },
        }),
      ],
    })
    expect(codesOf(collectTwin2dIssues(config))).toEqual(['dangling-style'])
  })

  it('文本图元引到样式里没有的槽时报出来', () => {
    const config = configOf({
      styles: [
        styleWith({
          prims: [txtPrim('__reading', { kind: 'slot', slot: 'temp' })],
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([
      {
        level: 'warn',
        code: 'dangling-slot',
        message: '找不到槽位 temp，这一格永远只显示占位符',
        at: 'styles[0].prims[0].src.slot',
      },
    ])
  })

  it('槽键为空表示这一处还没选槽，不算悬空', () => {
    const config = configOf({
      styles: [
        styleWith({ prims: [txtPrim('t', { kind: 'slot', slot: '' })] }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([])
  })

  it('文本的其它三档来源与非文本图元都不引槽', () => {
    const config = configOf({
      styles: [
        styleWith({
          prims: [
            txtPrim('t1', { kind: 'label' }),
            txtPrim('t2', { kind: 'lit', text: '水泵' }),
            txtPrim('t3', { kind: 'id' }),
            icoPrim('i1', { kind: 'none' }),
          ],
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([])
  })

  it('子图元里的悬空槽也扫得到，路径带 children', () => {
    const config = configOf({
      styles: [
        styleWith({
          prims: [
            boxPrim('__root', [txtPrim('__r', { kind: 'slot', slot: 'gone' })]),
          ],
        }),
      ],
    })
    expect(collectTwin2dIssues(config)[0]?.at).toBe(
      'styles[0].prims[0].children[0].src.slot',
    )
  })

  it('变体条件里的 slot / has / not 三档都扫槽引用', () => {
    const nested: Twin2dCondition = {
      kind: 'not',
      of: { kind: 'slot', slot: 'c', op: 'gt', value: 1, value2: null },
    }
    const config = configOf({
      styles: [
        styleWith({
          variants: [
            {
              id: 'v0',
              when: {
                kind: 'slot',
                slot: 'a',
                op: 'gt',
                value: 1,
                value2: null,
              },
              patch: {},
              rootPatch: {},
            },
            {
              id: 'v1',
              when: { kind: 'has', slots: ['b'], mode: 'any' },
              patch: {},
              rootPatch: {},
            },
            { id: 'v2', when: nested, patch: {}, rootPatch: {} },
          ],
        }),
      ],
    })
    expect(collectTwin2dIssues(config).map((issue) => issue.at)).toEqual([
      'styles[0].variants[0].when.slot',
      'styles[0].variants[1].when.slots[0]',
      'styles[0].variants[2].when.of.slot',
    ])
  })

  it('不引槽的三档变体条件不报任何问题', () => {
    const config = configOf({
      styles: [
        styleWith({
          variants: [
            {
              id: 'v0',
              when: { kind: 'state', state: 'hover' },
              patch: {},
              rootPatch: {},
            },
            {
              id: 'v1',
              when: { kind: 'status', in: ['alarm'] },
              patch: {},
              rootPatch: {},
            },
            {
              id: 'v2',
              when: { kind: 'tag', key: 'sub', in: ['a'] },
              patch: {},
              rootPatch: {},
            },
          ],
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([])
  })

  it('派生槽算式的六档递归都扫得到悬空槽', () => {
    const expr: Twin2dExpr = {
      kind: 'first',
      of: [
        { kind: 'slot', slot: 'a' },
        {
          kind: 'ratio',
          num: { kind: 'slot', slot: 'b' },
          den: { kind: 'lit', value: 1 },
          scale: 1,
        },
        { kind: 'scale', of: { kind: 'slot', slot: 'c' }, by: 2 },
        { kind: 'sum', of: [{ kind: 'slot', slot: 'd' }] },
        { kind: 'join', of: [{ kind: 'slot', slot: 'e' }], sep: ' ' },
      ],
    }
    const config = configOf({
      styles: [styleWith({ slots: [slotOf('eff', expr)] })],
    })
    expect(collectTwin2dIssues(config).map((issue) => issue.at)).toEqual([
      'styles[0].slots[0].expr.of[0].slot',
      'styles[0].slots[0].expr.of[1].num.slot',
      'styles[0].slots[0].expr.of[2].of.slot',
      'styles[0].slots[0].expr.of[3].of[0].slot',
      'styles[0].slots[0].expr.of[4].of[0].slot',
    ])
  })

  it('节点追加的图元引到节点自己追加的槽不算悬空，引到别的才报', () => {
    const config = configOf({
      styles: [styleWith({ slots: [slotOf('temp', null)] })],
      nodes: [
        nodeWith({
          slots: [slotOf('extra', null)],
          layers: [
            txtPrim('l0', { kind: 'slot', slot: 'extra' }),
            txtPrim('l1', { kind: 'slot', slot: 'temp' }),
            txtPrim('l2', { kind: 'slot', slot: 'gone' }),
          ],
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([
      {
        level: 'warn',
        code: 'dangling-slot',
        message: '找不到槽位 gone，这一格永远只显示占位符',
        at: 'nodes[0].layers[2].src.slot',
      },
    ])
  })

  it('节点追加的派生槽算式也扫，样式取不到时整个节点跳过', () => {
    const withStyle = configOf({
      styles: [styleWith({})],
      nodes: [
        nodeWith({ slots: [slotOf('d', { kind: 'slot', slot: 'gone' })] }),
      ],
    })
    expect(collectTwin2dIssues(withStyle).map((issue) => issue.at)).toEqual([
      'nodes[0].slots[0].expr.slot',
    ])
    const noStyle = configOf({
      nodes: [
        nodeWith({
          styleId: 'st-gone',
          slots: [slotOf('d', { kind: 'slot', slot: 'gone' })],
        }),
      ],
    })
    expect(onlyCode(collectTwin2dIssues(noStyle), 'dangling-slot')).toEqual([])
  })

  it('覆盖补丁的键在图元树里找不到时报出来', () => {
    const config = configOf({
      styles: [styleWith({ prims: [boxPrim('__root', [])] })],
      nodes: [nodeWith({ patch: { __root: { z: 1 }, __gone: { z: 2 } } })],
    })
    expect(collectTwin2dIssues(config)).toEqual([
      {
        level: 'warn',
        code: 'dangling-prim',
        message: '图元树里没有 __gone，这条覆盖补丁一句也不会生效',
        at: 'nodes[0].patch.__gone',
      },
    ])
  })

  it('补丁指到节点自己追加的图元也算数；样式取不到时不判补丁', () => {
    const config = configOf({
      styles: [styleWith({})],
      nodes: [
        nodeWith({
          layers: [boxPrim('__extra', [])],
          patch: { __extra: { z: 1 } },
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([])
    const noStyle = configOf({
      nodes: [nodeWith({ styleId: 'st-gone', patch: { __gone: { z: 1 } } })],
    })
    expect(onlyCode(collectTwin2dIssues(noStyle), 'dangling-prim')).toEqual([])
  })

  it('矢量图元引到本图元里没有的渐变 id 时报出来', () => {
    const config = configOf({
      styles: [
        styleWith({
          prims: [
            vecPrim('v0', { kind: 'gradient', id: 'g-gone' }, [
              gradientOf('g1'),
            ]),
          ],
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([
      {
        level: 'error',
        code: 'dangling-gradient',
        message: '本图元里没有渐变 g-gone，这一笔会整个不上色',
        at: 'styles[0].prims[0].fill.id',
      },
    ])
  })

  it('渐变 id 对得上、或根本不走渐变档的矢量图元都不报', () => {
    const config = configOf({
      styles: [
        styleWith({
          prims: [
            vecPrim('v0', { kind: 'gradient', id: 'g1' }, [gradientOf('g1')]),
            vecPrim('v1', { kind: 'color', color: '#fff' }, []),
            vecPrim('v2', { kind: 'none' }, []),
          ],
        }),
      ],
    })
    expect(collectTwin2dIssues(config)).toEqual([])
  })

  it('四个方向出界的拐点各报一条，落在边线上不算出界', () => {
    const config = configOf({
      styles: [styleWith({})],
      nodes: [nodeWith({ id: 'n1' }), nodeWith({ id: 'n2' })],
      edges: [
        edgeWith({
          waypoints: [
            { x: -1, y: 10 },
            { x: 10, y: -1 },
            { x: 1001, y: 10 },
            { x: 10, y: 801 },
            { x: 0, y: 800 },
            { x: 1000, y: 0 },
          ],
        }),
      ],
    })
    const issues = collectTwin2dIssues(config)
    expect(issues.map((issue) => issue.at)).toEqual([
      'edges[0].waypoints[0]',
      'edges[0].waypoints[1]',
      'edges[0].waypoints[2]',
      'edges[0].waypoints[3]',
    ])
    expect(issues[0]).toEqual({
      level: 'warn',
      code: 'waypoint-out-of-canvas',
      message: '拐点 (-1, 10) 在 1000×800 的画布外，这条线会绕出可视区',
      at: 'edges[0].waypoints[0]',
    })
  })

  it('注入的取样式函数让预置样式里的端口、槽与图元 id 都查得到', () => {
    const preset = styleWith({
      id: 'preset',
      prims: [txtPrim('__r', { kind: 'slot', slot: 'temp' })],
      ports: [portOf('p1')],
      slots: [slotOf('temp', null)],
    })
    const config = configOf({
      nodes: [
        nodeWith({ id: 'n1', styleId: 'preset', patch: { __r: { z: 1 } } }),
      ],
      edges: [
        edgeWith({
          from: { nodeId: 'n1', portId: 'p1', t: null },
          to: { nodeId: 'n1', portId: '', t: null },
        }),
      ],
    })
    const options = {
      knownStyleIds: new Set(['preset']),
      styleOf: () => preset,
    }
    expect(collectTwin2dIssues(config, options)).toEqual([])
  })

  it('取样式函数返回 null 时端口 / 槽 / 补丁三样都不判，不硬报一堆假问题', () => {
    const config = configOf({
      nodes: [
        nodeWith({
          id: 'n1',
          styleId: 'preset',
          layers: [txtPrim('__r', { kind: 'slot', slot: 'gone' })],
          patch: { __gone: { z: 1 } },
        }),
      ],
      edges: [
        edgeWith({
          from: { nodeId: 'n1', portId: 'p1', t: null },
          to: { nodeId: 'n1', portId: '', t: null },
        }),
      ],
    })
    expect(
      collectTwin2dIssues(config, {
        knownStyleIds: new Set(['preset']),
        styleOf: () => null,
      }),
    ).toEqual([])
  })

  it('吃的是原始 JSON：手写的一份脏文档也判得出悬空端口', () => {
    const raw = {
      styles: [{ id: 'st', ports: [{ id: 'p1' }] }],
      nodes: [{ id: 'n1', styleId: 'st' }],
      edges: [
        {
          id: 'e1',
          from: { nodeId: 'n1', portId: 'p-gone' },
          to: { nodeId: 'n1' },
        },
      ],
    }
    expect(collectTwin2dIssues(raw)).toEqual([
      {
        level: 'error',
        code: 'dangling-port',
        message: '节点 n1 上没有端口 p-gone，这一端会退回朝向对方中心',
        at: 'edges[0].from.portId',
      },
    ])
  })

  it('整份文档不是对象时一条都不报，不是抛错', () => {
    expect(collectTwin2dIssues(null)).toEqual([])
    expect(collectTwin2dIssues('twin2d')).toEqual([])
  })

  it('同 id 时以文档里的样式为准，注入的预置样式让位', () => {
    const preset = styleWith({ id: 'st', ports: [portOf('p-preset')] })
    const config = configOf({
      styles: [styleWith({ id: 'st', ports: [portOf('p-doc')] })],
      nodes: [nodeWith({ id: 'n1' })],
      edges: [
        edgeWith({
          from: { nodeId: 'n1', portId: 'p-preset', t: null },
          to: { nodeId: 'n1', portId: 'p-doc', t: null },
        }),
      ],
    })
    expect(collectTwin2dIssues(config, { styleOf: () => preset })).toEqual([
      {
        level: 'error',
        code: 'dangling-port',
        message: '节点 n1 上没有端口 p-preset，这一端会退回朝向对方中心',
        at: 'edges[0].from.portId',
      },
    ])
  })
})

describe('诊断词汇表', () => {
  it('两族产出的 code 与 level 都落在名单里，名单本身没有重复', () => {
    const raw = {
      styles: [
        {
          id: 'st',
          prims: [
            { id: 't', kind: 'txt', src: { kind: 'slot', slot: 'gone' } },
          ],
          slots: [{ label: '没 key' }],
        },
      ],
      nodes: [{ id: 'n1', styleId: 'st-gone' }],
    }
    const issues = collectTwin2dIssues(raw)
    expect(codesOf(issues)).toEqual([
      'dangling-style',
      'dangling-slot',
      'dropped-slot',
    ])
    expect(issues.every((one) => TWIN_2D_ISSUE_CODES.includes(one.code))).toBe(
      true,
    )
    expect(
      issues.every((one) => TWIN_2D_ISSUE_LEVELS.includes(one.level)),
    ).toBe(true)
    expect(new Set(TWIN_2D_ISSUE_CODES).size).toBe(TWIN_2D_ISSUE_CODES.length)
  })
})
