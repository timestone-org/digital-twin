/**
 * @fileoverview 锁住大纲文件夹归一化的契约：非法夹与悬空成员剔除、同 kind 跨夹
 * 重复取先见者、id 缺失按下标铸造保幂等，且实体表先归一（夹按归一化后的 id 判悬空）。
 */
import { describe, expect, it } from 'vitest'

import { normalizeTwinConfig } from '../src/normalize'
import { normalizeFolders } from '../src/normalizeFolders'
import type { TwinFolderHosts } from '../src/normalizeFolders'

/** 七类实体各给一份 id 载体；缺省全空，按需覆盖。 */
function hosts(over: Partial<TwinFolderHosts> = {}): TwinFolderHosts {
  return {
    parts: [],
    anchors: [],
    cameras: [],
    panels: [],
    arrows: [],
    flows: [],
    ...over,
  }
}

const ANCHOR_HOSTS = hosts({ anchors: [{ id: 'a1' }, { id: 'a2' }] })

describe('单夹的形状', () => {
  it('非 record 的夹整条丢弃', () => {
    expect(normalizeFolders([null, 'x', 42, []], ANCHOR_HOSTS)).toEqual([])
  })

  it('kind 不在闭合集合里时丢整夹', () => {
    expect(
      normalizeFolders(
        [{ id: 'f1', kind: 'ghosts', itemIds: ['a1'] }],
        ANCHOR_HOSTS,
      ),
    ).toEqual([])
  })

  it('id 缺失按原始下标铸 fold-<index>，再跑一遍不再变', () => {
    const raw = [null, { kind: 'anchors', itemIds: ['a1'] }]
    const once = normalizeFolders(raw, ANCHOR_HOSTS)

    expect(once[0]?.id).toBe('fold-1')
    expect(normalizeFolders(once, ANCHOR_HOSTS)).toEqual(once)
  })

  // 撞名的两夹会在下游按夹 id 分组时互抢成员、Vue key 也重复
  it('铸 id 避让显式 id：显式 fold-1 在场时缺 id 夹铸成 fold-2', () => {
    const folders = normalizeFolders(
      [
        { id: 'fold-1', kind: 'anchors', itemIds: [] },
        { kind: 'anchors', itemIds: ['a1'] },
      ],
      ANCHOR_HOSTS,
    )

    expect(folders.map((folder) => folder.id)).toEqual(['fold-1', 'fold-2'])
    expect(folders[0]?.itemIds).toEqual([])
    expect(folders[1]?.itemIds).toEqual(['a1'])
  })

  it('铸 id 也避让先铸出的 id，顺延到头一个空位', () => {
    const folders = normalizeFolders(
      [
        { kind: 'anchors', itemIds: [] },
        { kind: 'anchors', itemIds: [] },
        { id: 'fold-1', kind: 'anchors', itemIds: [] },
      ],
      ANCHOR_HOSTS,
    )

    // 第一夹按下标铸 fold-0；第二夹的 fold-1 已被显式占用，顺延成 fold-2
    expect(folders.map((folder) => folder.id)).toEqual([
      'fold-0',
      'fold-2',
      'fold-1',
    ])
  })

  it('名字去空白，非字符串归空串', () => {
    const folders = normalizeFolders(
      [
        { id: 'f1', kind: 'anchors', name: ' 温度组 ', itemIds: [] },
        { id: 'f2', kind: 'anchors', name: 42, itemIds: [] },
      ],
      ANCHOR_HOSTS,
    )

    expect(folders.map((folder) => folder.name)).toEqual(['温度组', ''])
  })

  it('空夹合法，成员表归成空数组', () => {
    expect(
      normalizeFolders([{ id: 'f1', kind: 'anchors' }], ANCHOR_HOSTS),
    ).toEqual([{ id: 'f1', kind: 'anchors', name: '', itemIds: [] }])
  })
})

describe('成员表', () => {
  it('悬空的 itemId 剔掉，实体表里有的留着', () => {
    const folders = normalizeFolders(
      [{ id: 'f1', kind: 'anchors', itemIds: ['a1', 'ghost', 'a2'] }],
      ANCHOR_HOSTS,
    )

    expect(folders[0]?.itemIds).toEqual(['a1', 'a2'])
  })

  it('悬空按夹自己的 kind 判：别的类里有同名 id 也不算', () => {
    const mixed = hosts({ parts: [{ id: 'x' }] })

    expect(
      normalizeFolders([{ id: 'f1', kind: 'anchors', itemIds: ['x'] }], mixed),
    ).toEqual([{ id: 'f1', kind: 'anchors', name: '', itemIds: [] }])
  })

  it('夹内自重复只留一份', () => {
    const folders = normalizeFolders(
      [{ id: 'f1', kind: 'anchors', itemIds: ['a1', 'a1', ' a1 '] }],
      ANCHOR_HOSTS,
    )

    expect(folders[0]?.itemIds).toEqual(['a1'])
  })

  it('同 kind 跨夹重复取先见者，后面的夹里剔掉', () => {
    const folders = normalizeFolders(
      [
        { id: 'f1', kind: 'anchors', itemIds: ['a1'] },
        { id: 'f2', kind: 'anchors', itemIds: ['a1', 'a2'] },
      ],
      ANCHOR_HOSTS,
    )

    expect(folders[0]?.itemIds).toEqual(['a1'])
    expect(folders[1]?.itemIds).toEqual(['a2'])
  })

  it('不同 kind 的夹互不抢成员：跨夹去重只在同类内做', () => {
    const mixed = hosts({
      anchors: [{ id: 'same' }],
      parts: [{ id: 'same' }],
    })
    const folders = normalizeFolders(
      [
        { id: 'f1', kind: 'anchors', itemIds: ['same'] },
        { id: 'f2', kind: 'parts', itemIds: ['same'] },
      ],
      mixed,
    )

    expect(folders[0]?.itemIds).toEqual(['same'])
    expect(folders[1]?.itemIds).toEqual(['same'])
  })
})

describe('整表', () => {
  it('旧配置没有 folders 时归成空表', () => {
    expect(normalizeFolders(undefined, ANCHOR_HOSTS)).toEqual([])
    expect(normalizeTwinConfig({}).folders).toEqual([])
  })

  it('非数组的 folders 当没配', () => {
    expect(normalizeFolders('nope', ANCHOR_HOSTS)).toEqual([])
  })

  // ⚠ 悬空判定拿的是归一化后的实体 id：铸出来的 anchor-0 也算在场，
  // 顺序倒了（先归夹再归实体）会把这类合法成员误剔
  it('成员指向铸造 id 的实体时不算悬空', () => {
    const config = normalizeTwinConfig({
      anchors: [{ name: '没给 id' }],
      folders: [{ id: 'f1', kind: 'anchors', itemIds: ['anchor-0'] }],
    })

    expect(config.folders[0]?.itemIds).toEqual(['anchor-0'])
  })

  it('走了避让路径铸出的 id 再归一一遍逐字段相等', () => {
    const once = normalizeTwinConfig({
      anchors: [{ id: 'a1' }],
      folders: [
        { id: 'fold-1', kind: 'anchors', itemIds: [] },
        { kind: 'anchors', itemIds: ['a1'] },
      ],
    })

    expect(once.folders.map((folder) => folder.id)).toEqual([
      'fold-1',
      'fold-2',
    ])
    expect(normalizeTwinConfig(once)).toEqual(once)
  })

  it('归一化两遍逐字段相等：悬空、跨夹重复与铸 id 都收敛', () => {
    const raw = {
      anchors: [{ id: 'a1' }, { name: '铸 id' }],
      folders: [
        { kind: 'anchors', itemIds: ['a1', 'ghost'] },
        { id: 'f2', kind: 'anchors', itemIds: ['a1', 'anchor-1'] },
        { kind: 'nope', itemIds: ['a1'] },
      ],
    }
    const once = normalizeTwinConfig(raw)

    expect(normalizeTwinConfig(once)).toEqual(once)
    expect(once.folders).toEqual([
      { id: 'fold-0', kind: 'anchors', name: '', itemIds: ['a1'] },
      { id: 'f2', kind: 'anchors', name: '', itemIds: ['anchor-1'] },
    ])
  })
})
