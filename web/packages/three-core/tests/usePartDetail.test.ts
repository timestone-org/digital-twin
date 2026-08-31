/**
 * @fileoverview 契约：详情弹窗开在谁身上、装配栏里正看着谁，以及换配置之后
 * 这两样怎么对账。
 *
 * ⚠ 对账留下一个不在场的 id 就是「弹窗开着、画面一块黑」：那份克隆材质已经随
 * 主场景重建作废，而没有任何报错指回来。
 */
import { normalizeTwinConfig, type TwinPart } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { usePartDetail } from '../src/usePartDetail'

function partsOf(raw: Record<string, unknown>[]): TwinPart[] {
  return normalizeTwinConfig({ parts: raw }).parts
}

const UNIT = partsOf([
  { id: 'unit', name: '机组' },
  { id: 'air', name: '主机', parentId: 'unit' },
  { id: 'motor', name: '电机', parentId: 'unit' },
])

function partNamed(parts: readonly TwinPart[], id: string): TwinPart {
  const part = parts.find((item) => item.id === id)
  if (part === undefined) throw new Error(`没有部件 ${id}`)
  return part
}

describe('详情开关', () => {
  it('一开始没开，也没有当前件', () => {
    const detail = usePartDetail()

    expect(detail.part.value).toBeNull()
    expect(detail.currentId.value).toBe('')
  })

  // ⚠ 留着上一次的选择，会让点开另一台设备时右边显示的是上一台里某个子件的读数
  it('换一个部件打开时清空当前件', () => {
    const detail = usePartDetail()
    detail.open(partNamed(UNIT, 'unit'))
    detail.select('motor')

    detail.open(partNamed(UNIT, 'air'))

    expect(detail.currentId.value).toBe('')
  })

  it('关掉时两样都清', () => {
    const detail = usePartDetail()
    detail.open(partNamed(UNIT, 'unit'))
    detail.select('motor')

    detail.close()

    expect(detail.part.value).toBeNull()
    expect(detail.currentId.value).toBe('')
  })
})

describe('换配置之后对账', () => {
  it('换成新那一份部件，旧引用不留', () => {
    const detail = usePartDetail()
    detail.open(partNamed(UNIT, 'unit'))
    const next = partsOf([{ id: 'unit', name: '机组（改名）' }])

    detail.sync(next)

    expect(detail.part.value).toBe(partNamed(next, 'unit'))
  })

  it('打开的那个部件没了就关掉', () => {
    const detail = usePartDetail()
    detail.open(partNamed(UNIT, 'unit'))
    detail.select('motor')

    detail.sync(partsOf([{ id: 'other' }]))

    expect(detail.part.value).toBeNull()
    expect(detail.currentId.value).toBe('')
  })

  it('当前件还在装配里就留着', () => {
    const detail = usePartDetail()
    detail.open(partNamed(UNIT, 'unit'))
    detail.select('motor')

    detail.sync(UNIT)

    expect(detail.currentId.value).toBe('motor')
  })

  it('当前件被删了就退回打开的那一个', () => {
    const detail = usePartDetail()
    detail.open(partNamed(UNIT, 'unit'))
    detail.select('motor')

    detail.sync(partsOf([{ id: 'unit' }, { id: 'air', parentId: 'unit' }]))

    expect(detail.currentId.value).toBe('')
  })

  // 改挂到别的父件下面，它就不在这一棵装配里了
  it('当前件被挪出这棵装配也退回', () => {
    const detail = usePartDetail()
    detail.open(partNamed(UNIT, 'unit'))
    detail.select('motor')

    detail.sync(partsOf([{ id: 'unit' }, { id: 'motor' }]))

    expect(detail.currentId.value).toBe('')
  })

  it('没开着时对账什么都不做', () => {
    const detail = usePartDetail()

    detail.sync(UNIT)

    expect(detail.part.value).toBeNull()
  })
})
