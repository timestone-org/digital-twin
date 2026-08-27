/**
 * @fileoverview 锁住文件夹操作的两条硬契约：一切进出夹都不动七个实体数组
 * （文档序 = 数组绑定的对齐位次），以及「先摘再放」——跨夹去重取先见者，
 * 不摘的话往夹表后面的夹移动会静默失败。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  NEW_FOLDER_NAME,
  addFolder,
  moveIntoFolder,
  removeFolder,
  removeFromFolder,
  renameFolder,
} from '@/pages/TwinEditor/scripts/folderOps'
import type { TwinEntityKind } from '@/pages/TwinEditor/scripts/types'

const ENTITY_KINDS: readonly TwinEntityKind[] = [
  'parts',
  'anchors',
  'cameras',
  'panels',
  'arrows',
  'flows',
]

function makeConfig(over: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({
    parts: [{ id: 'p1', name: '主机' }],
    anchors: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
    cameras: [{ id: 'c1' }],
    panels: [{ id: 'pl1', anchorId: 'a1' }],
    arrows: [{ id: 'ar1' }],
    flows: [{ id: 'fl1', pathAnchors: ['a1', 'a2'] }],
    folders: [
      { id: 'f1', kind: 'anchors', name: '前段', itemIds: ['a1'] },
      { id: 'f2', kind: 'anchors', name: '后段', itemIds: [] },
      { id: 'fp', kind: 'parts', name: '整机', itemIds: ['p1'] },
    ],
    ...over,
  })
}

/** 七个实体数组的逐字快照，进出夹前后必须逐字相等。 */
function entitySnapshot(config: TwinConfig): string {
  return JSON.stringify(ENTITY_KINDS.map((kind) => config[kind]))
}

/** 注入的 id 工厂：可预期的固定序列。 */
function idFactoryOf(...ids: string[]) {
  let cursor = 0
  return (prefix: string): string => {
    const id = ids[cursor] ?? `${prefix}-x${cursor}`
    cursor += 1
    return id
  }
}

describe('addFolder', () => {
  it('追加一个空夹在夹表末尾，名字是「新文件夹」，返回夹 id', () => {
    const { config, id } = addFolder(
      makeConfig(),
      'anchors',
      idFactoryOf('fold-new'),
    )

    expect(id).toBe('fold-new')
    expect(config.folders.at(-1)).toEqual({
      id: 'fold-new',
      kind: 'anchors',
      name: NEW_FOLDER_NAME,
      itemIds: [],
    })
  })

  it('id 工厂给出已用的 id 时避开它另铸一个', () => {
    const { config, id } = addFolder(makeConfig(), 'parts', () => 'f1')

    expect(id).not.toBe('f1')
    expect(id.startsWith('fold-')).toBe(true)
    expect(config.folders.filter((folder) => folder.id === 'f1')).toHaveLength(
      1,
    )
  })

  it('建夹不动实体数组', () => {
    const before = makeConfig()

    const { config } = addFolder(before, 'flows', idFactoryOf('fold-new'))

    expect(entitySnapshot(config)).toBe(entitySnapshot(before))
  })
})

describe('renameFolder', () => {
  it('改名落到那一个夹上，前后空白归一化剥掉', () => {
    const next = renameFolder(makeConfig(), 'f1', ' 进水段 ')

    expect(next.folders[0]?.name).toBe('进水段')
    expect(next.folders[1]?.name).toBe('后段')
  })

  it('夹不存在时原引用返回', () => {
    const config = makeConfig()

    expect(renameFolder(config, 'ghost', '随便')).toBe(config)
  })

  // 原引用返回让 doc.commit 不记帧：改名弹框原样确认不该白吃一步撤销
  it('trim 后名字没变时原引用返回', () => {
    const config = makeConfig()

    expect(renameFolder(config, 'f1', ' 前段 ')).toBe(config)
  })
})

describe('removeFolder', () => {
  it('只删夹对象，成员回散行、实体数组逐字不动', () => {
    const before = makeConfig()

    const next = removeFolder(before, 'f1')

    expect(next.folders.map((folder) => folder.id)).toEqual(['f2', 'fp'])
    expect(entitySnapshot(next)).toBe(entitySnapshot(before))
  })

  it('夹不存在时原引用返回', () => {
    const config = makeConfig()

    expect(removeFolder(config, 'ghost')).toBe(config)
  })
})

describe('moveIntoFolder', () => {
  it('散行移入指定夹，追加在夹内末尾', () => {
    const next = moveIntoFolder(makeConfig(), 'f1', 'a2')

    expect(next.folders[0]?.itemIds).toEqual(['a1', 'a2'])
  })

  // 回归靶：归一化的跨夹去重取先见者，不先摘出的话这一步会静默失败
  it('从前面的夹挪到夹表后面的夹必须成功', () => {
    const next = moveIntoFolder(makeConfig(), 'f2', 'a1')

    expect(next.folders[0]?.itemIds).toEqual([])
    expect(next.folders[1]?.itemIds).toEqual(['a1'])
    // 别的 kind 的夹不受同类去重牵连
    expect(next.folders[2]?.itemIds).toEqual(['p1'])
  })

  it('目标夹不存在时原引用返回', () => {
    const config = makeConfig()

    expect(moveIntoFolder(config, 'ghost', 'a1')).toBe(config)
  })

  it('实体不属于夹的 kind 时原引用返回', () => {
    const config = makeConfig()

    expect(moveIntoFolder(config, 'f1', 'p1')).toBe(config)
    expect(moveIntoFolder(config, 'f1', '不存在')).toBe(config)
  })

  it('移回已在的夹是幂等的：成员表不重复', () => {
    const next = moveIntoFolder(makeConfig(), 'f1', 'a1')

    expect(next.folders[0]?.itemIds).toEqual(['a1'])
  })

  it('进夹不动七个实体数组', () => {
    const before = makeConfig()

    const next = moveIntoFolder(before, 'f2', 'a1')

    expect(entitySnapshot(next)).toBe(entitySnapshot(before))
  })
})

describe('removeFromFolder', () => {
  it('从所在夹摘出，回到散行', () => {
    const next = removeFromFolder(makeConfig(), 'a1')

    expect(next.folders[0]?.itemIds).toEqual([])
  })

  it('不在任何夹里时原引用返回', () => {
    const config = makeConfig()

    expect(removeFromFolder(config, 'a3')).toBe(config)
  })

  it('出夹不动七个实体数组', () => {
    const before = makeConfig()

    const next = removeFromFolder(before, 'a1')

    expect(entitySnapshot(next)).toBe(entitySnapshot(before))
  })
})
