/**
 * @fileoverview 守 2D 孪生清单的声明：套框吃全套外观、绑定槽直接摊开公共常量、
 * 状态子槽刻意不给 `enumMap`、三个槽的行数都由清单自述，整段图文档交给子编辑器。
 * ⚠ 这一批错法 typecheck 与 lint 双双放行，表现只是「配了没反应」。
 */
import type { BindingSpec } from '@dt/contracts'
import {
  TWIN_2D_CONFIG_KEY,
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_STATUS_BINDING_KEY,
  TWIN_2D_VIEW_BINDINGS,
} from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/twin-2d-view/manifest'

/** 一张只有一个节点、一条连线的图，用来看行数与行标题。 */
const SCENE = {
  version: 1,
  nodes: [
    { id: 'hx', styleId: 'heat-exchanger', label: '换热站' },
    { id: 'term', styleId: 'bath-terminal', label: '洗浴终端' },
  ],
  edges: [{ id: 'e1', from: { nodeId: 'hx' }, to: { nodeId: 'term' } }],
}

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

function binding(key: string): BindingSpec | undefined {
  return manifest.bindings.find((item) => item.key === key)
}

describe('2D 孪生清单的身份', () => {
  it('是孪生分类下的一块套框模块，图标取网络拓扑那一枚', () => {
    expect(manifest.type).toBe('twin-2d-view')
    expect(manifest.category).toBe('孪生')
    expect(manifest.icon).toBe('network')
    // 缺省即 card：套框能白拿全套统一外观，同时少一份自绘代码
    expect(manifest.chrome).toBeUndefined()
  })

  // ⚠ 套框模块吃全部 chrome 键：声明了「不支持」的键会被属性面板藏掉，
  //   而藏错的那一项在渲染上照样生效，两边说的话从此对不上
  it('一个 chrome 键都不声明为不支持', () => {
    expect(manifest.unsupportedChromeKeys).toBeUndefined()
  })

  it('配置面按标题、画面、运行态三组分开，没有一组叫模块名', () => {
    const groups = [...new Set(manifest.configSchema.map((item) => item.group))]

    expect(groups).toEqual(['标题', '画面', '运行态'])
    expect(groups).not.toContain(manifest.displayName)
  })
})

describe('2D 孪生清单的状态与联动声明', () => {
  it('逐格自报取数状态，坏一个读数不盖住整块', () => {
    expect(manifest.ownsStatusDisplay).toBe(true)
  })

  // ⚠ 缺省是 `['click']`，而本模块上抛的是 `'select'`：不声明的话编辑器的
  //   「触发事件」下拉里只有 click，用户配出来的规则永远不触发，两侧都不报错
  it('上抛的事件名显式声明成 select，不吃缺省的 click', () => {
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.interactionEvents).toEqual(['select'])
  })

  // ⚠ 画布内部有拖拽手势，整块可点会让每次拖完松手都派发一次 click
  it('整块可点刻意不开', () => {
    expect(manifest.hostClickable).toBeUndefined()
  })

  // ⚠ 四个字段任一写错都不报错：接管的键不对就照旧画 JSON 框，路由名不对就
  //   「点了没反应」。路由是否真存在由 app 那侧的 sub-editor-routes 契约兜
  it('图文档那一段交给 2D 孪生编辑器接管', () => {
    expect(manifest.subEditor).toEqual({
      configKey: TWIN_2D_CONFIG_KEY,
      routeName: 'twin-2d-editor',
      label: '打开 2D 孪生编辑器',
      hint: '节点、连线、标注与节点样式都在那里画。',
    })
  })

  // 接管的键必须真在自己的 schema 里，否则入口永远不出现——而字段照旧画成 JSON 框
  it('被接管的键就是 schema 里那个没有 fields 的 object 字段', () => {
    const taken = field(manifest.subEditor?.configKey ?? '')
    expect(taken?.type).toBe('object')
    expect(taken?.fields).toBeUndefined()
  })
})

describe('2D 孪生清单的绑定槽', () => {
  it('绑定槽直接摊开公共常量，不在清单里抄一份键名', () => {
    expect(manifest.bindings).toEqual([...TWIN_2D_VIEW_BINDINGS])
  })

  it('三个槽都是钉在实体上的数组槽，索引可以留空', () => {
    const keys = [
      TWIN_2D_NODE_BINDING_KEY,
      TWIN_2D_STATUS_BINDING_KEY,
      TWIN_2D_EDGE_BINDING_KEY,
    ]

    expect(keys.map((key) => binding(key)?.isArray)).toEqual([true, true, true])
    expect(keys.map((key) => binding(key)?.isEntityPinned)).toEqual([
      true,
      true,
      true,
    ])
  })

  it('每个数组槽都声明了自己的行内子槽', () => {
    expect(
      binding(TWIN_2D_NODE_BINDING_KEY)?.arrayFields?.map((sub) => sub.key),
    ).toEqual(['value'])
    expect(
      binding(TWIN_2D_STATUS_BINDING_KEY)?.arrayFields?.map((sub) => sub.key),
    ).toEqual(['status'])
    expect(
      binding(TWIN_2D_EDGE_BINDING_KEY)?.arrayFields?.map((sub) => sub.key),
    ).toEqual(['active', 'direction', 'value'])
  })

  /**
   * ⚠ 声明了语义键会让求值层的 `applyEnumMap` 把 1 换成映射表里的那个串，换完
   * `toDeviceStatus` 认不出来，于是全图状态集体退回「无数据」而变灰，且零报错。
   * 数值原样进来才对——数值表只有 `NUMERIC_STATUSES` 一份真源。
   */
  it('状态子槽刻意不给 enumMap', () => {
    expect(
      binding(TWIN_2D_STATUS_BINDING_KEY)?.arrayFields?.[0]?.enumMap,
    ).toBeUndefined()
  })
})

describe('2D 孪生清单自述的绑定行', () => {
  // ⚠ 漏掉键会被绑点面板当成「行数由用户手工增删」，于是摆出一个加了也喂不到
  //   任何东西的「新增一行」
  it('三个槽的行数都给了，一个实体都没有时给零', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({
      [TWIN_2D_NODE_BINDING_KEY]: 0,
      [TWIN_2D_STATUS_BINDING_KEY]: 0,
      [TWIN_2D_EDGE_BINDING_KEY]: 0,
    })
  })

  it('行数跟着图上的实体走：两个节点一条连线', () => {
    const counts = manifest.bindingRowCounts?.({ [TWIN_2D_CONFIG_KEY]: SCENE })

    expect(counts?.[TWIN_2D_STATUS_BINDING_KEY]).toBe(2)
    expect(counts?.[TWIN_2D_EDGE_BINDING_KEY]).toBe(1)
  })

  // 只给名字的话，两个同名实体在面板上长得一模一样，用户只能靠数行号确认绑对了没有
  it('行标题给的是名字加实体 id 两样', () => {
    const labels = manifest.bindingRowLabels?.({ [TWIN_2D_CONFIG_KEY]: SCENE })

    expect(labels?.['nodeStatus[0].status']).toEqual({
      title: '换热站',
      id: 'hx',
    })
    expect(labels?.['edgeValues[0].active']).toEqual({
      title: '换热站 → 洗浴终端',
      id: 'e1',
    })
  })
})

describe('2D 孪生清单的配置字段', () => {
  // ⚠ default 会 materialize 进每一次渲染：标题缺省即「不显示标题条」，
  //   流动动画缺省即「不动」，给上 default 等于改存量大屏的渲染结果
  it('标题与流动动画开关刻意不给缺省', () => {
    expect(field('title')?.default).toBeUndefined()
    expect(field('animateFlow')?.default).toBeUndefined()
  })

  it('画面那一段的缺省与舞台里写死那版逐值相同', () => {
    expect(field('fitMode')?.default).toBe('contain')
    expect(field('fitPadding')).toMatchObject({ default: 4, min: 0, max: 20 })
    expect(field('showSprite')?.default).toBe(true)
    expect(field('flowSpeed')).toMatchObject({ default: 1, min: 0.5, max: 5 })
  })

  // ⚠ 刻意不给 fields：图元树与定长数组两列通用表单表达不了，属性面板对
  //   「object 且无 fields」的字段画只读摘要而不是一块空白
  it('图那一段是不给子表单的 object', () => {
    expect(field(TWIN_2D_CONFIG_KEY)?.type).toBe('object')
    expect(field(TWIN_2D_CONFIG_KEY)?.fields).toBeUndefined()
  })

  // ⚠ 条件指着一个不存在的键时那个字段永远不显示，而属性面板一声不吭
  it('两条显示条件都指着清单里真有的字段', () => {
    const declared = new Set(manifest.configSchema.map((item) => item.key))
    const pointed = ['fitPadding', 'flowSpeed'].map(
      (key) => field(key)?.when?.key ?? '',
    )

    expect(pointed.map((key) => declared.has(key))).toEqual([true, true])
  })

  it('两条显示条件各自只在那一档取值下成立', () => {
    expect(field('fitPadding')?.when?.in).toEqual(['contain'])
    expect(field('flowSpeed')?.when?.in).toEqual([true])
  })

  it('缩放档的下拉项就是舞台认得的那四档', () => {
    expect((field('fitMode')?.options ?? []).map((item) => item.value)).toEqual(
      ['contain', 'width', 'height', 'stretch'],
    )
  })
})

describe('2D 孪生清单的演示配置', () => {
  // ⚠ 演示配置只走渲染那条路：拿它去改标题条或内边距，画布上子节点会被顶下去，
  //   而保存后运行态又是另一个样子
  it('演示只给图这一个键，不碰别的配置', () => {
    expect(Object.keys(manifest.preview?.config ?? {})).toEqual([
      TWIN_2D_CONFIG_KEY,
    ])
  })

  it('演示图是一条三节点两连线的链路', () => {
    const scene = manifest.preview?.config?.[TWIN_2D_CONFIG_KEY]

    expect(scene).toMatchObject({
      nodes: [{ id: 'src' }, { id: 'hx' }, { id: 'term' }],
      edges: [{ id: 'e1' }, { id: 'e2' }],
    })
  })
})
