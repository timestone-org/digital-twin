/**
 * @fileoverview 契约：折线点串与路径 d 的文本互转——分隔符两收、认不出的整对丢弃、
 * 写出去的数不带浮点噪声。
 *
 * ⚠ 手打的那一份与画布取点产出的那一份必须逐字同源：两处各写一台格式化器的表现是
 * 两条本该重合的线在末位小数上错开，而图上看不出来。
 */
import { describe, expect, it } from 'vitest'

import {
  twin2dNumText,
  twin2dParsePoints,
  twin2dPointsPath,
  twin2dPointsText,
} from '@/pages/Twin2dEditor/scripts/shapeText'

describe('写出去的数', () => {
  it('抹掉浮点噪声', () => {
    expect(twin2dNumText(0.1 + 0.2)).toBe('0.3')
  })

  it('整数不补小数点', () => {
    expect(twin2dNumText(24)).toBe('24')
  })

  it('负数与小数原样保留三位', () => {
    expect(twin2dNumText(-1.2345)).toBe('-1.234')
  })
})

describe('点串与文本', () => {
  it('点串写成逗号加空格的一行', () => {
    expect(
      twin2dPointsText([
        [0, 0],
        [12, 0],
      ]),
    ).toBe('0,0 12,0')
  })

  it('空点串写成空串', () => {
    expect(twin2dPointsText([])).toBe('')
  })

  it('逗号与空白都当分隔符', () => {
    expect(twin2dParsePoints('0,0 12 4')).toEqual([
      [0, 0],
      [12, 4],
    ])
  })

  // ⚠ 认不出的那一个丢掉之后，后面的数会与前一个配成对，这正是逐键解析要的
  it('认不出的数整个丢掉', () => {
    expect(twin2dParsePoints('0,0 a,3 5,6')).toEqual([
      [0, 0],
      [3, 5],
    ])
  })

  it('落单的末位配不成对，一并丢掉', () => {
    expect(twin2dParsePoints('0,0 12')).toEqual([[0, 0]])
  })

  it('空串解析成一个点都没有', () => {
    expect(twin2dParsePoints('   ')).toEqual([])
  })
})

describe('点串与路径', () => {
  it('首点提笔，其余连线', () => {
    expect(
      twin2dPointsPath([
        [0, 0],
        [3, 4],
      ]),
    ).toBe('M 0 0 L 3 4')
  })

  it('空点串拼出空 d', () => {
    expect(twin2dPointsPath([])).toBe('')
  })

  it('路径里的数与框里的数同一台格式化器', () => {
    expect(twin2dPointsPath([[0.1 + 0.2, 1]])).toBe('M 0.3 1')
  })
})
