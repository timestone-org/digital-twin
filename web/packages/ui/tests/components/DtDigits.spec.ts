/**
 * @fileoverview DtDigits 的切分与无障碍契约。
 * ⚠ 读屏读的必须是整串文本、逐字格子整体隐藏：反过来做的话时钟会被一个字符
 * 一个字符地念出来，而这在视觉上完全看不出区别。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtDigits from '../../src/components/DtDigits/DtDigits.vue'

// ⚠ 不能用 wrapper.text()：它会 trim，分隔空格那一格会被读成空串
function cellsMatching(value: string, selector: string): string[] {
  return mount(DtDigits, { props: { value } })
    .findAll(selector)
    .map((cell) => cell.element.textContent ?? '')
}

function cells(value: string): string[] {
  return cellsMatching(value, '.dt-digits__cell')
}

function digitCells(value: string): string[] {
  return cellsMatching(value, '.dt-digits__cell--digit')
}

describe('DtDigits 切分', () => {
  it('逐字符切成格子', () => {
    expect(cells('12:30')).toEqual(['1', '2', ':', '3', '0'])
  })

  it('空串不产生格子', () => {
    expect(cells('')).toEqual([])
  })

  it('CJK 与空格照常保留', () => {
    expect(cells('08 周四')).toEqual(['0', '8', ' ', '周', '四'])
  })

  it('⚠ 组合字符不被拆开：拆了会渲染成错乱字形', () => {
    expect(cells('é')).toEqual(['é'])
  })

  it('ZWJ emoji 序列算一格', () => {
    expect(cells('👨‍👩‍👧')).toEqual(['👨‍👩‍👧'])
  })

  it('星标外的字符也只占一格', () => {
    expect(cells('𝟚')).toEqual(['𝟚'])
  })
})

describe('DtDigits 锁宽', () => {
  it('只有 ASCII 数字锁 1ch', () => {
    expect(digitCells('12:30')).toEqual(['1', '2', '3', '0'])
  })

  it('冒号与连字符不锁宽，它们本来就是恒宽的', () => {
    expect(digitCells('--:--')).toEqual([])
  })

  it('⚠ 全角数字不锁宽：1ch 量的是当前字体半角 0 的宽度', () => {
    expect(digitCells('１２')).toEqual([])
  })

  it('数学粗体数字同样不锁宽', () => {
    expect(digitCells('𝟚')).toEqual([])
  })
})

describe('DtDigits 无障碍', () => {
  it('读屏读到的是完整的一串', () => {
    const wrapper = mount(DtDigits, { props: { value: '12:30' } })
    expect(wrapper.find('.dt-digits__text').text()).toBe('12:30')
  })

  it('逐字格子整体对读屏隐藏', () => {
    const wrapper = mount(DtDigits, { props: { value: '12:30' } })
    expect(wrapper.find('.dt-digits__cells').attributes('aria-hidden')).toBe(
      'true',
    )
  })

  it('外部改值时读屏文本与格子一起跟上', async () => {
    const wrapper = mount(DtDigits, { props: { value: '12:30' } })
    await wrapper.setProps({ value: '12:31' })
    expect(wrapper.find('.dt-digits__text').text()).toBe('12:31')
    expect(
      wrapper
        .findAll('.dt-digits__cell')
        .map((cell) => cell.element.textContent ?? ''),
    ).toEqual(['1', '2', ':', '3', '1'])
  })
})
