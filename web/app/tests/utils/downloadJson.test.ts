/**
 * @fileoverview 导出落盘：文件名要能真的写进文件系统，对象 URL 要释放。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadJson, toFileName } from '@/utils/downloadJson'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('文件名规整', () => {
  it('原样保留正常名字', () => {
    expect(toFileName('产线总览')).toBe('产线总览')
  })

  it('把路径分隔符与保留字符换成下划线', () => {
    expect(toFileName('a/b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i')
  })

  it('整串都被滤掉时给兜底名', () => {
    expect(toFileName('///')).toBe('dashboard')
    expect(toFileName('  ')).toBe('dashboard')
  })
})

describe('触发下载', () => {
  it('按规整后的名字下载，并把对象 URL 释放掉', () => {
    const created = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:probe')
    const revoked = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})
    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => {})
    vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    downloadJson({ name: '总览' }, 'a/b')

    expect(created).toHaveBeenCalledTimes(1)
    expect(anchor.download).toBe('a_b.json')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revoked).toHaveBeenCalledWith('blob:probe')
  })
})
