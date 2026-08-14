/**
 * @fileoverview 占位图必须是确定性的：同一张屏每次画出同一张图。
 * ⚠ 用随机数的话，同一张卡片每次挂载都换个样子，看上去像是这张屏的内容在变。
 */
import { describe, expect, it } from 'vitest'

import {
  createRandom,
  hashString,
  placeholderBlocks,
} from '@/pages/Home/thumbnailPlaceholder'

describe('确定性散列与伪随机', () => {
  it('同一个字符串散列成同一个数', () => {
    expect(hashString('dash-1')).toBe(hashString('dash-1'))
  })

  it('不同字符串散列出不同的数', () => {
    expect(hashString('dash-1')).not.toBe(hashString('dash-2'))
  })

  it('散列值落在 32 位无符号范围内', () => {
    const hash = hashString('某个中文名字')
    expect(Number.isInteger(hash)).toBe(true)
    expect(hash).toBeGreaterThanOrEqual(0)
    expect(hash).toBeLessThan(2 ** 32)
  })

  it('同一个种子吐出同一串数', () => {
    const first = createRandom(42)
    const second = createRandom(42)
    expect([first(), first(), first()]).toEqual([second(), second(), second()])
  })

  it('伪随机取值落在 [0, 1)', () => {
    const random = createRandom(7)
    for (let index = 0; index < 20; index += 1) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('占位方块', () => {
  it('同一个大屏 id 每次都生成完全一样的方块', () => {
    expect(placeholderBlocks('d-1')).toEqual(placeholderBlocks('d-1'))
  })

  it('不同大屏 id 生成不同的排布', () => {
    expect(placeholderBlocks('d-1')).not.toEqual(placeholderBlocks('d-2'))
  })

  it('方块的 key 各不相同，免得 v-for 拿下标当身份', () => {
    const keys = placeholderBlocks('d-3').map((block) => block.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('方块不会跑出画面', () => {
    for (const block of placeholderBlocks('d-4')) {
      expect(block.leftPercent + block.widthPercent).toBeLessThanOrEqual(100)
      expect(block.topPercent + block.heightPercent).toBeLessThanOrEqual(100)
    }
  })
})
