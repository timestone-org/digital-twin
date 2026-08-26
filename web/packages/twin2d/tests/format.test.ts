/**
 * @fileoverview 锁住 2D 孪生读数格式化的口径：缺值一律占位符而不是伪造 0、配置来的
 * 小数位越界不许抛、-0 不许显成「-0」、`fmtKwh` 取整后判档，以及三处 `toLocaleString`
 * 都钉死 'en-US'（跟随系统 locale 会在中文 runner 上红得莫名其妙）。
 */
import { describe, expect, it } from 'vitest'

import {
  NO_DATA,
  fmtClock,
  fmtDecimal,
  fmtFixed,
  fmtKwh,
  fmtNumber,
  fmtTrim,
  formatSlotValue,
  isPresent,
} from '../src/format'
import type { Twin2dSlotFormat } from '../src/format'

function slotOf(over: Partial<Twin2dSlotFormat>): Twin2dSlotFormat {
  return {
    precision: null,
    unit: '',
    enumMap: {},
    placeholder: NO_DATA,
    ...over,
  }
}

describe('NO_DATA', () => {
  it('占位符是 em dash，不是两个连字符', () => {
    expect(NO_DATA).toBe('—')
  })
})

describe('isPresent', () => {
  it('有限数算有值，真实 0 也算', () => {
    expect(isPresent(0)).toBe(true)
    expect(isPresent(-3.5)).toBe(true)
  })

  it('缺值、非有限数与数字形状的串都不算', () => {
    expect(isPresent(null)).toBe(false)
    expect(isPresent(undefined)).toBe(false)
    expect(isPresent(Number.NaN)).toBe(false)
    expect(isPresent(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isPresent('12')).toBe(false)
  })
})

describe('fmtFixed', () => {
  it('缺省零位，缺值给占位符', () => {
    expect(fmtFixed(1.5)).toBe('2')
    expect(fmtFixed(null)).toBe(NO_DATA)
  })

  it('补零到指定位数', () => {
    expect(fmtFixed(63.4, 2)).toBe('63.40')
  })

  it('位数越界钳到 [0,100] 而不是抛 RangeError', () => {
    expect(fmtFixed(1.5, -3)).toBe('2')
    expect(fmtFixed(1.5, 200).split('.')[1]?.length).toBe(100)
  })

  it('位数不是有限数时回缺省零位', () => {
    expect(fmtFixed(1.234, Number.NaN)).toBe('1')
  })
})

describe('fmtNumber', () => {
  it('缺省两位、带千分位，缺值给占位符', () => {
    expect(fmtNumber(1234.5678)).toBe('1,234.57')
    expect(fmtNumber(undefined)).toBe(NO_DATA)
  })

  it('位数 ≤0 时先四舍五入到整数', () => {
    expect(fmtNumber(1234.5678, 0)).toBe('1,235')
    expect(fmtNumber(1234.5678, -2)).toBe('1,235')
  })

  it('位数不是有限数时回缺省两位', () => {
    expect(fmtNumber(1234.5678, Number.NaN)).toBe('1,234.57')
  })

  it('-0 归一成 0，不显「-0」', () => {
    expect(fmtNumber(-0)).toBe('0')
  })

  it("locale 钉死 'en-US'：小数点是点、千分位是逗号", () => {
    expect(fmtNumber(1234.5678)).toBe(
      (1234.5678).toLocaleString('en-US', { maximumFractionDigits: 2 }),
    )
    expect(fmtNumber(1234.5678)).not.toBe(
      (1234.5678).toLocaleString('de-DE', { maximumFractionDigits: 2 }),
    )
  })
})

describe('fmtTrim', () => {
  it('抹掉尾随零：63.40 出 63.4', () => {
    expect(fmtTrim(63.4, 2)).toBe('63.4')
  })

  it('不带千分位，缺省最多两位', () => {
    expect(fmtTrim(1234.5678)).toBe('1234.57')
  })

  it('-0 归一成 0，缺值给占位符', () => {
    expect(fmtTrim(-0)).toBe('0')
    expect(fmtTrim(Number.NaN)).toBe(NO_DATA)
  })

  it('位数越界钳到 100，非有限数回缺省两位', () => {
    expect(fmtTrim(1.23456789, 300)).toBe('1.23456789')
    expect(fmtTrim(1.23456789, Number.NaN)).toBe('1.23')
  })

  it("locale 钉死 'en-US'：小数点是点而不是逗号", () => {
    expect(fmtTrim(1.5)).toBe(
      (1.5).toLocaleString('en-US', {
        maximumFractionDigits: 2,
        useGrouping: false,
      }),
    )
    expect(fmtTrim(1.5)).not.toBe(
      (1.5).toLocaleString('de-DE', {
        maximumFractionDigits: 2,
        useGrouping: false,
      }),
    )
  })
})

describe('fmtKwh', () => {
  it('判档用取整后的绝对值：999.6 与 1000 同显 1k', () => {
    expect(fmtKwh(999.6)).toBe('1k')
    expect(fmtKwh(1000)).toBe('1k')
  })

  it('取整后不足一千显整数', () => {
    expect(fmtKwh(999.4)).toBe('999')
  })

  it('负数带号，压缩档按精度保留小数', () => {
    expect(fmtKwh(-1500)).toBe('-1.5k')
    expect(fmtKwh(-999.4)).toBe('-999')
    expect(fmtKwh(1234.5, 1)).toBe('1.2k')
  })

  it('缺值给占位符', () => {
    expect(fmtKwh(null)).toBe(NO_DATA)
  })
})

describe('fmtDecimal', () => {
  it('缺省一位且补零，与 fmtTrim 的抹零分工相反', () => {
    expect(fmtDecimal(63)).toBe('63.0')
    expect(fmtTrim(63)).toBe('63')
  })

  it('缺省不带千分位，开了才带', () => {
    expect(fmtDecimal(1234.5)).toBe('1234.5')
    expect(fmtDecimal(1234.5, 1, true)).toBe('1,234.5')
  })

  it('位数越界钳到 [0,100]，非有限数回缺省一位', () => {
    expect(fmtDecimal(1234.6, -5)).toBe('1235')
    expect(fmtDecimal(1234.6, Number.NaN)).toBe('1234.6')
  })

  it('-0 归一成 0，缺值给占位符', () => {
    expect(fmtDecimal(-0)).toBe('0.0')
    expect(fmtDecimal(Number.POSITIVE_INFINITY)).toBe(NO_DATA)
  })

  it("locale 钉死 'en-US'：小数点是点而不是逗号", () => {
    expect(fmtDecimal(1.5)).toBe(
      (1.5).toLocaleString('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        useGrouping: false,
      }),
    )
    expect(fmtDecimal(1.5)).not.toBe(
      (1.5).toLocaleString('de-DE', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        useGrouping: false,
      }),
    )
  })
})

describe('fmtClock', () => {
  it('给出本地时的时:分:秒，逐位补零', () => {
    // ⚠ 用本地时构造：写死一个纪元毫秒的话，CI 与开发机的时区不同就会各断各的
    const early = new Date(2026, 0, 2, 3, 4, 5)
    const late = new Date(2026, 0, 2, 23, 59, 59)

    expect(fmtClock(early.getTime())).toBe('03:04:05')
    expect(fmtClock(late.getTime())).toBe('23:59:59')
  })

  it('超出 Date 可表示范围的毫秒数给占位符，不编一个时刻出来', () => {
    expect(fmtClock(8.64e15 + 1)).toBe(NO_DATA)
  })

  it('缺值与非数一律给占位符', () => {
    expect(fmtClock(null)).toBe(NO_DATA)
    expect(fmtClock('刚刚')).toBe(NO_DATA)
  })
})

describe('formatSlotValue', () => {
  it('precision 为 null 时整数直出、小数走一位并抹掉尾随零', () => {
    const slot = slotOf({ unit: 'kW' })

    expect(formatSlotValue(42, slot)).toBe('42 kW')
    expect(formatSlotValue(63.44, slot)).toBe('63.4 kW')
    expect(formatSlotValue(63.4, slot)).toBe('63.4 kW')
  })

  it('给了 precision 就定点补零', () => {
    expect(formatSlotValue(63.4, slotOf({ precision: 2, unit: '%' }))).toBe(
      '63.40 %',
    )
  })

  it('-0 显成 0', () => {
    expect(formatSlotValue(-0, slotOf({}))).toBe('0')
  })

  it('空单位不留尾随空格', () => {
    expect(formatSlotValue(42, slotOf({}))).toBe('42')
  })

  it('映射表命中时优先出词条，且不拼单位', () => {
    const slot = slotOf({ unit: 'kW', enumMap: { '1': '运行' } })

    expect(formatSlotValue(1, slot)).toBe('运行')
  })

  it('映射表的键一律按 String(value) 查，布尔与字符串同样命中', () => {
    const slot = slotOf({ enumMap: { true: '通电', off: '停机' } })

    expect(formatSlotValue(true, slot)).toBe('通电')
    expect(formatSlotValue('off', slot)).toBe('停机')
  })

  it('映射表未命中或词条是空串时，当没配这张表', () => {
    const slot = slotOf({ enumMap: { '1': '运行', '2': '' } })

    expect(formatSlotValue(3, slot)).toBe('3')
    expect(formatSlotValue(2, slot)).toBe('2')
  })

  it('字符串读数去空白后原样带单位', () => {
    expect(formatSlotValue('  高  ', slotOf({ unit: '档' }))).toBe('高 档')
  })

  it('⚠ 数字字符串走的也是原样文本那一支，precision 一概不套', () => {
    expect(formatSlotValue('60', slotOf({ precision: 2, unit: 'kW' }))).toBe(
      '60 kW',
    )
  })

  it('缺值给槽位自己的占位符，不伪造 0', () => {
    const slot = slotOf({ placeholder: '--', unit: 'kW' })

    expect(formatSlotValue(null, slot)).toBe('--')
    expect(formatSlotValue(undefined, slot)).toBe('--')
    expect(formatSlotValue(Number.NaN, slot)).toBe('--')
    expect(formatSlotValue(Number.POSITIVE_INFINITY, slot)).toBe('--')
    expect(formatSlotValue('   ', slot)).toBe('--')
  })

  it('没有映射表的布尔与对象落占位符，不凭空显成 1', () => {
    const slot = slotOf({ placeholder: '--' })

    expect(formatSlotValue(true, slot)).toBe('--')
    expect(formatSlotValue({ v: 1 }, slot)).toBe('--')
  })

  it('占位符是空串时兜底成 NO_DATA', () => {
    expect(formatSlotValue(null, slotOf({ placeholder: '' }))).toBe(NO_DATA)
  })
})
