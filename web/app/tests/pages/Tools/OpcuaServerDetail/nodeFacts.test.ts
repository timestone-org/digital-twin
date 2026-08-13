/**
 * @fileoverview OPC UA 裸数字的翻译层。
 *
 * ⚠ 这里每条用例守的都是同一件事：**界面上不许出现没人看得懂的编码**。
 * `access_level: 3` 摆出去，用户只会以为自己漏了什么。
 */
import { describe, expect, it } from 'vitest'
import { isIconName } from '@dt/ui'

import {
  FALLBACK_NODE_ICON,
  NODE_ICON_NAMES,
  accessLabels,
  displayValue,
  iconOfClass,
  isWritable,
  valueRankLabel,
} from '@/pages/Tools/OpcuaServerDetail/nodeFacts'

describe('节点图标', () => {
  it.each([
    ['object', 'layout-grid'],
    ['variable', 'activity'],
    ['property', 'table'],
  ])('%s → %s', (nodeClass, icon) => {
    expect(iconOfClass(nodeClass)).toBe(icon)
  })

  it('没登记的类别走兜底，而不是返回空名字', () => {
    expect(iconOfClass('method')).toBe(FALLBACK_NODE_ICON)
    expect(iconOfClass('')).toBe(FALLBACK_NODE_ICON)
  })

  // ⚠ 树里是动态绑定 `:name`，DtIcon 的契约测试只扫字面量，扫不到这些。
  // 名字写错时 DtIcon 什么都不画，界面上只是图标位置空着——没有任何报错。
  it('用到的图标名全都在注册表里', () => {
    for (const name of NODE_ICON_NAMES) {
      expect(isIconName(name), `${name} 没登记进图标注册表`).toBe(true)
    }
  })

  it('兜底图标也在名单里，漏检不了', () => {
    expect(NODE_ICON_NAMES).toContain(FALLBACK_NODE_ICON)
  })
})

describe('访问级别', () => {
  it.each([
    [1, ['可读']],
    [2, ['可写']],
    [3, ['可读', '可写']],
    [15, ['可读', '可写', '可读历史', '可写历史']],
  ])('掩码 %i 翻成 %j', (level, labels) => {
    expect(accessLabels(level)).toEqual(labels)
  })

  it('⚠ 0 是合法取值，要说「不可读写」而不是留白', () => {
    expect(accessLabels(0)).toEqual(['不可读写'])
  })

  it.each([
    [0, false],
    [1, false],
    [2, true],
    [3, true],
  ])('掩码 %i 可写 = %s', (level, writable) => {
    expect(isWritable(level)).toBe(writable)
  })
})

describe('值维度', () => {
  it.each([
    [-3, '标量或一维数组'],
    [-2, '任意维度'],
    [-1, '标量'],
    [0, '一维或更高'],
    [1, '一维数组'],
  ])('规范取值 %i 有名字', (rank, label) => {
    expect(valueRankLabel(rank)).toBe(label)
  })

  it('规范之外的维数按 N 维数组说', () => {
    expect(valueRankLabel(3)).toBe('3 维数组')
  })
})

describe('值的展示', () => {
  it('⚠ 还没取到（undefined）与取到了空（null）必须分得开', () => {
    expect(displayValue(undefined)).toBe('—')
    expect(displayValue(null)).toBe('null')
  })

  it('字符串原样出，不加引号', () => {
    expect(displayValue('12')).toBe('12')
  })

  it.each([
    [0, '0'],
    [3.5, '3.5'],
    [false, 'false'],
  ])('%s 直接转字符串', (value, text) => {
    expect(displayValue(value)).toBe(text)
  })

  it('数组与结构体 JSON 化，不许落成 [object Object]', () => {
    expect(displayValue([1, 2])).toBe('[1,2]')
    expect(displayValue({ a: 1 })).toBe('{"a":1}')
  })
})
