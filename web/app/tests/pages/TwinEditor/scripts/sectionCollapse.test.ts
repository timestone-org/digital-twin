/**
 * @fileoverview 分区折叠记忆：用户点过的按用户的来，没点过的按各检查器的初值；
 * 记忆跨实体保持——切一次实体就复位的话，配二十个部件要展开二十次同一节。
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  __resetSectionCollapse,
  isSectionOpen,
  setSectionOpen,
} from '@/pages/TwinEditor/scripts/sectionCollapse'

afterEach(__resetSectionCollapse)

describe('初值', () => {
  it('没点过时按调用方给的初值', () => {
    expect(isSectionOpen('显隐', true)).toBe(true)
    expect(isSectionOpen('按距离行为', false)).toBe(false)
  })
})

describe('记忆', () => {
  it('点过之后按用户的来，初值不再起作用', () => {
    setSectionOpen('按距离行为', true)

    expect(isSectionOpen('按距离行为', false)).toBe(true)
  })

  it('折叠一节之后，另一个实体的同名节也是折叠的', () => {
    // 在部件上折叠「显隐」，切到信息牌时这一节仍该是折叠的
    setSectionOpen('显隐', false)

    expect(isSectionOpen('显隐', true)).toBe(false)
  })

  it('各节互不影响', () => {
    setSectionOpen('外观', false)

    expect(isSectionOpen('外观', true)).toBe(false)
    expect(isSectionOpen('字段', true)).toBe(true)
  })
})
