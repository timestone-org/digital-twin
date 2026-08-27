/**
 * @fileoverview 契约：样式库那一列的行推导——两类样式并成一列、来路四档决定给哪几枚
 * 键、关键字过滤按名字与 id 一起找。
 *
 * ⚠ 只有 `override` 那一档给「恢复内置」，`custom` 那一档给「删除」：两档摆同一枚键
 * 会让用户以为自建样式也恢复得回来，而它删掉就没了。
 * ⚠ 预置库里那一份既不给删也不给恢复：它本来就不在文档里，删它是一步什么都不做的
 * 空动作，而按钮看着能按。
 */
import {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_EDGE_PRESETS,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  twin2dStyleLibFilter,
  twin2dStyleLibRows,
} from '@/pages/Twin2dEditor/scripts/styleLibrary'
import type { Twin2dStyleLibRow } from '@/pages/Twin2dEditor/scripts/styleLibrary'

/** 夹具坏了要当场炸。 */
function firstId(list: readonly { id: string }[], what: string): string {
  const id = list[0]?.id
  if (id === undefined) throw new Error(`${what} 是空的`)
  return id
}

const BUILTIN_ID = firstId(TWIN_2D_BUILTIN_NODE_STYLES, '预置节点样式库')
const PRESET_EDGE_ID = firstId(TWIN_2D_EDGE_PRESETS, '预置连线样式库')

const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  styles: [
    { id: BUILTIN_ID, name: '压着的' },
    { id: 'mine', name: '自建' },
  ],
  edgeStyles: [{ id: PRESET_EDGE_ID }, { id: 'own-wire', name: '自建线' }],
  nodes: [
    { id: 'n1', styleId: 'mine' },
    { id: 'n2', styleId: 'mine' },
  ],
})

/**
 * 按 key 取一行。
 * @param rows 整座库
 * @param key 那一行的 key
 */
function rowOf(
  rows: readonly Twin2dStyleLibRow[],
  key: string,
): Twin2dStyleLibRow {
  const found = rows.find((row) => row.key === key)
  if (found === undefined) throw new Error(`库里没有 ${key}`)
  return found
}

const ROWS = twin2dStyleLibRows(CONFIG)

describe('并成一列', () => {
  it('节点样式在前、连线样式在后', () => {
    const kinds = [...new Set(ROWS.map((row) => row.kind))]

    expect(kinds).toEqual(['styles', 'edgeStyles'])
  })

  it('预置库整份都在，文档里自建的接在后面', () => {
    expect(ROWS.filter((row) => row.kind === 'styles')).toHaveLength(
      TWIN_2D_BUILTIN_NODE_STYLES.length + 1,
    )
    expect(ROWS.filter((row) => row.kind === 'edgeStyles')).toHaveLength(
      TWIN_2D_EDGE_PRESETS.length + 1,
    )
  })

  it('没起名的那一份退到 id，不留一行空白', () => {
    expect(rowOf(ROWS, `edgeStyles:${PRESET_EDGE_ID}`).name).not.toBe('')
  })

  it('副名写着类别与 id', () => {
    expect(rowOf(ROWS, 'styles:mine').note).toContain('mine')
    expect(rowOf(ROWS, 'styles:mine').note).toContain('节点样式')
  })
})

describe('来路决定给哪几枚键', () => {
  it('压着覆盖的那一档给恢复内置，不给删除', () => {
    const row = rowOf(ROWS, `styles:${BUILTIN_ID}`)

    expect(row.origin).toBe('override')
    expect(row.originLabel).toBe('覆盖内置')
    expect(row.canRestore).toBe(true)
    expect(row.canRemove).toBe(false)
  })

  it('自建的那一档给删除，不给恢复内置', () => {
    const row = rowOf(ROWS, 'styles:mine')

    expect(row.origin).toBe('custom')
    expect(row.canRestore).toBe(false)
    expect(row.canRemove).toBe(true)
  })

  it('只在预置库里的那一档两枚都不给', () => {
    const clean = twin2dStyleLibRows(normalizeTwin2dConfig({}))
    const row = rowOf(clean, `styles:${BUILTIN_ID}`)

    expect(row.origin).toBe('builtin')
    expect(row.canRestore).toBe(false)
    expect(row.canRemove).toBe(false)
  })

  it('数得出还有几个实体在用', () => {
    expect(rowOf(ROWS, 'styles:mine').usedBy).toBe(2)
    expect(rowOf(ROWS, `styles:${BUILTIN_ID}`).usedBy).toBe(0)
  })
})

describe('关键字过滤', () => {
  it('空白串不过滤，交回原样那一列', () => {
    expect(twin2dStyleLibFilter(ROWS, '   ')).toBe(ROWS)
  })

  it('按名字找', () => {
    const hit = twin2dStyleLibFilter(ROWS, '自建')

    expect(hit.map((row) => row.id)).toEqual(['mine', 'own-wire'])
  })

  // ⚠ 只按名字过滤会让用户确信这份样式已经不在了：几十条时他记得住的常常只有 id
  it('按 id 也找得到', () => {
    const hit = twin2dStyleLibFilter(ROWS, 'own-wire')

    expect(hit.map((row) => row.id)).toEqual(['own-wire'])
  })

  it('大小写不敏感', () => {
    const hit = twin2dStyleLibFilter(ROWS, 'OWN-WIRE')

    expect(hit).toHaveLength(1)
  })

  it('一条都不匹配就交回空表', () => {
    expect(twin2dStyleLibFilter(ROWS, '不存在的东西')).toEqual([])
  })
})
