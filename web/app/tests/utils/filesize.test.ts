/**
 * @fileoverview 契约：字节数的人读形式按 1024 进制换算。
 * ⚠ 换成 1000 进制的话，「单个文件最大 256 MB」的提示与服务端 policy 真正
 * 拒掉的那条线对不上，而两边的数字看着都很正常。
 */
import { describe, expect, it } from 'vitest'

import { formatSize } from '@/utils/filesize'

describe('字节数', () => {
  it('不足一档就按字节写', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(999)).toBe('999 B')
  })

  it('按 1024 进位，不是 1000', () => {
    expect(formatSize(1024)).toBe('1 KB')
    expect(formatSize(1000)).toBe('1000 B')
    expect(formatSize(256 * 1024 * 1024)).toBe('256 MB')
  })

  it('整数不补 .0——那读起来像是量出来的精度', () => {
    expect(formatSize(2 * 1024 * 1024)).toBe('2 MB')
  })

  it('小数只在个位数档留一位', () => {
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(15 * 1024 + 512)).toBe('16 KB')
  })

  it('顶到 GB 就不再进位', () => {
    expect(formatSize(2048 * 1024 * 1024 * 1024)).toBe('2048 GB')
  })

  it('负数按 0 处理，不写出「-1 B」这种读不通的值', () => {
    expect(formatSize(-1)).toBe('0 B')
  })
})
