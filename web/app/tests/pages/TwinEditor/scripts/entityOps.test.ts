/**
 * @fileoverview 六类实体的增删改移。
 * ⚠ 这一层的每个函数都必须**返回新对象**：文档态靠换引用触发重渲染与压撤销栈，
 * 就地改的那一次界面照常刷新，但撤销回去等于什么都没变。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  addEntity,
  duplicateEntity,
  moveEntity,
  newEntityId,
  removeEntity,
  updateEntity,
} from '@/pages/TwinEditor/scripts/entityOps'

/** 可预期的 id 工厂：按调用次序发号。 */
function sequence(): (prefix: string) => string {
  let index = 0
  return (prefix) => {
    index += 1
    return `${prefix}-${index}`
  }
}

const EMPTY = normalizeTwinConfig({})

describe('新增', () => {
  it('追加在末尾，并回新实体的 id', () => {
    const first = addEntity(EMPTY, 'anchors', sequence())

    expect(first.id).toBe('anchor-1')
    expect(first.config.anchors).toHaveLength(1)
    expect(first.config.anchors[0]?.id).toBe('anchor-1')
  })

  it('名字按序号排，空名字在大纲树上没法认', () => {
    const one = addEntity(EMPTY, 'anchors', sequence())
    const two = addEntity(one.config, 'anchors', sequence())

    expect(two.config.anchors[1]?.name).toBe('锚点 2')
  })

  it('新信息牌自带一个字段，不是一张空卡片', () => {
    const added = addEntity(EMPTY, 'panels', sequence())

    expect(added.config.panels[0]?.fields).toHaveLength(1)
  })

  // ⚠ 重名会让两个实体抢同一份实时值，界面上看不出是重名造成的
  it('id 撞了会另换一个，不产生重名', () => {
    const taken = normalizeTwinConfig({ anchors: [{ id: 'anchor-1' }] })
    const added = addEntity(taken, 'anchors', () => 'anchor-1')

    expect(added.id).not.toBe('anchor-1')
    expect(new Set(added.config.anchors.map((item) => item.id)).size).toBe(2)
  })

  it('缺省 id 带前缀，一眼看得出是什么', () => {
    expect(newEntityId('anchor')).toMatch(/^anchor-[0-9a-f]{6}$/)
  })

  it('原来那份配置一个字都没被改', () => {
    addEntity(EMPTY, 'anchors', sequence())

    expect(EMPTY.anchors).toHaveLength(0)
  })
})

describe('删除', () => {
  it('只删点名的那个', () => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a1' }, { id: 'a2' }],
    })

    const next = removeEntity(config, 'anchors', 'a1')

    expect(next.anchors.map((item) => item.id)).toEqual(['a2'])
  })

  // 悬空引用由诊断报给用户看；这里静默清掉的话用户会以为配的东西凭空消失
  it('不顺手清理指向它的引用', () => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a1' }],
      panels: [{ id: 'p1', anchorId: 'a1' }],
    })

    const next = removeEntity(config, 'anchors', 'a1')

    expect(next.panels[0]?.anchorId).toBe('a1')
  })

  it('删一个不存在的 id 不出错也不改动', () => {
    const config = normalizeTwinConfig({ anchors: [{ id: 'a1' }] })

    expect(removeEntity(config, 'anchors', 'nope').anchors).toHaveLength(1)
  })
})

describe('复制', () => {
  it('插在原件后面，换新 id 并改名', () => {
    const config = normalizeTwinConfig({
      anchors: [{ id: 'a1', name: '进口' }, { id: 'a2' }],
    })

    const next = duplicateEntity(config, 'anchors', 'a1', sequence())

    expect(next.config.anchors.map((item) => item.id)).toEqual([
      'a1',
      'anchor-1',
      'a2',
    ])
    expect(next.config.anchors[1]?.name).toBe('进口 副本')
  })

  it('复制不存在的 id 时原样返回', () => {
    const config = normalizeTwinConfig({ anchors: [{ id: 'a1' }] })

    const next = duplicateEntity(config, 'anchors', 'nope', sequence())

    expect(next.id).toBeNull()
    expect(next.config).toBe(config)
  })
})

describe('重排', () => {
  const config = normalizeTwinConfig({
    anchors: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
  })

  it('上移与下移各挪一格', () => {
    expect(
      moveEntity(config, 'anchors', 'a2', -1).anchors.map((item) => item.id),
    ).toEqual(['a2', 'a1', 'a3'])
    expect(
      moveEntity(config, 'anchors', 'a2', 1).anchors.map((item) => item.id),
    ).toEqual(['a1', 'a3', 'a2'])
  })

  it('顶到头再上移、到底再下移都原样返回', () => {
    expect(moveEntity(config, 'anchors', 'a1', -1)).toBe(config)
    expect(moveEntity(config, 'anchors', 'a3', 1)).toBe(config)
  })
})

describe('改字段', () => {
  it('只改点名的那个，其余原样', () => {
    const config = normalizeTwinConfig({
      anchors: [
        { id: 'a1', name: '旧' },
        { id: 'a2', name: '别动' },
      ],
    })

    const next = updateEntity(config, 'anchors', 'a1', { name: '新' })

    expect(next.anchors[0]?.name).toBe('新')
    expect(next.anchors[1]?.name).toBe('别动')
  })

  it('改不存在的 id 原样返回', () => {
    const config = normalizeTwinConfig({ anchors: [{ id: 'a1' }] })

    expect(updateEntity(config, 'anchors', 'nope', { name: 'x' })).toBe(config)
  })

  // 归一化收口在写操作里，缺省值只有一处定义
  it('写完仍是一份归一化的配置，缺省字段都在', () => {
    const config = normalizeTwinConfig({ anchors: [{ id: 'a1' }] })

    const next = updateEntity(config, 'anchors', 'a1', { name: '进口' })

    expect(next.anchors[0]?.visibility.visible).toBe(true)
    expect(next.anchors[0]?.decimals).toBeNull()
  })
})
