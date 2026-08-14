/**
 * @fileoverview 守节点树的归一：扁平表按 `parentId` 组装、同层按 `(zIndex, id)` 定序、
 * 清单缺省铺进配置，以及**容器身份来自注入的清单解析器**——少了它容器判不出来，
 * 它的子节点在渲染时全部静默消失。父指向不存在的节点或成环的节点不进树，另行报出。
 */
import { describe, expect, it } from 'vitest'

import { buildNodeTree, resolveModuleConfig } from '../src/nodeTree'
import { fakeCatalog, fakeManifest, fakeNode } from '../src/testing/fixtures'

const shellManifest = fakeManifest({
  type: 'shell',
  isContainer: true,
  configSchema: [
    { key: 'pad', label: '内边距', type: 'number', default: 8 },
    { key: 'title', label: '标题', type: 'string', default: '未命名' },
  ],
})

const leafManifest = fakeManifest({ type: 'leaf' })

const catalog = fakeCatalog([shellManifest, leafManifest])

describe('树的组装', () => {
  it('子节点挂在父节点下，顶层只留 parentId 为 null 的那些', () => {
    const view = buildNodeTree(
      [
        fakeNode({ id: 'root', moduleType: 'shell' }),
        fakeNode({ id: 'child', moduleType: 'leaf', parentId: 'root' }),
      ],
      catalog,
    )

    expect(view.roots.map((node) => node.id)).toEqual(['root'])
    expect(
      view.roots.flatMap((node) => node.children.map((n) => n.id)),
    ).toEqual(['child'])
  })

  it('同层按 zIndex 排，zIndex 相同再按 id', () => {
    const view = buildNodeTree(
      [
        fakeNode({ id: 'b', moduleType: 'leaf', zIndex: 2 }),
        fakeNode({ id: 'c', moduleType: 'leaf', zIndex: 1 }),
        fakeNode({ id: 'a', moduleType: 'leaf', zIndex: 1 }),
      ],
      catalog,
    )

    expect(view.roots.map((node) => node.id)).toEqual(['a', 'c', 'b'])
  })

  it('几何、显隐与绑定原样带进树视图', () => {
    const view = buildNodeTree(
      [
        fakeNode({
          id: 'one',
          moduleType: 'leaf',
          x: 12,
          y: 34,
          w: 300,
          h: 120,
          isVisible: false,
        }),
      ],
      catalog,
    )

    expect(view.roots.map((node) => node.box)).toEqual([
      { x: 12, y: 34, w: 300, h: 120 },
    ])
    expect(view.roots.map((node) => node.isVisible)).toEqual([false])
  })
})

describe('容器身份靠注入的清单解析器', () => {
  it('清单说是容器就是容器', () => {
    const view = buildNodeTree(
      [fakeNode({ id: 'root', moduleType: 'shell' })],
      catalog,
    )

    expect(view.roots.map((node) => node.isContainer)).toEqual([true])
  })

  it('不传解析器时一个容器都认不出来', () => {
    const view = buildNodeTree([fakeNode({ id: 'root', moduleType: 'shell' })])

    expect(view.roots.map((node) => node.isContainer)).toEqual([false])
  })

  it('清单里没有这个类型时按非容器算', () => {
    const view = buildNodeTree(
      [fakeNode({ id: 'root', moduleType: 'vendor-gauge' })],
      catalog,
    )

    expect(view.roots.map((node) => node.isContainer)).toEqual([false])
  })
})

describe('配置的缺省铺底', () => {
  it('清单缺省铺底，用户配置覆盖同名键', () => {
    const view = buildNodeTree(
      [
        fakeNode({
          id: 'root',
          moduleType: 'shell',
          configJson: { pad: 20 },
        }),
      ],
      catalog,
    )

    expect(view.roots.map((node) => node.config)).toEqual([
      { pad: 20, title: '未命名' },
    ])
  })

  it('对已经铺过缺省的配置再铺一次结果不变', () => {
    const once = resolveModuleConfig(shellManifest, { pad: 20 })

    expect(resolveModuleConfig(shellManifest, once)).toEqual(once)
  })

  it('清单缺失时只剩用户配置', () => {
    expect(resolveModuleConfig(undefined, { pad: 20 })).toEqual({ pad: 20 })
  })

  it('没有用户配置时就是一份清单缺省', () => {
    expect(resolveModuleConfig(shellManifest, undefined)).toEqual({
      pad: 8,
      title: '未命名',
    })
  })
})

describe('进不了树的节点', () => {
  it('父节点不存在的节点不冒充顶层，另行报出', () => {
    const view = buildNodeTree(
      [
        fakeNode({ id: 'root', moduleType: 'shell' }),
        fakeNode({ id: 'lost', moduleType: 'leaf', parentId: 'ghost' }),
      ],
      catalog,
    )

    expect(view.roots.map((node) => node.id)).toEqual(['root'])
    expect(view.detachedIds).toEqual(['lost'])
  })

  it('父子成环的那一圈进不了树，也不会无限递归', () => {
    const view = buildNodeTree(
      [
        fakeNode({ id: 'a', moduleType: 'shell', parentId: 'b' }),
        fakeNode({ id: 'b', moduleType: 'shell', parentId: 'a' }),
        fakeNode({ id: 'top', moduleType: 'leaf' }),
      ],
      catalog,
    )

    expect(view.roots.map((node) => node.id)).toEqual(['top'])
    expect(view.detachedIds).toEqual(['a', 'b'])
  })

  it('自己当自己父节点的那一个同样进不了树', () => {
    const view = buildNodeTree(
      [fakeNode({ id: 'self', moduleType: 'shell', parentId: 'self' })],
      catalog,
    )

    expect(view.roots).toEqual([])
    expect(view.detachedIds).toEqual(['self'])
  })
})
