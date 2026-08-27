/**
 * @fileoverview 守 gauge-card 几何数学的五条契约：量程非法一律给 null 而不是 NaN／0，
 * 填充比例夹而完成率不夹，大弧标志跟着张角翻，厚度的「0 = 随形状」三种落库形态同义，
 * 以及贴边标签的对齐基准与参考仓逐个刻度一致。
 * ⚠ 这几条错了都不报错：弧照样画、数字照样跳，只是画反了、或者百分比是伪造的。
 */
import { describe, expect, it } from 'vitest'

import {
  arcAngleAt,
  arcAngles,
  arcDashOffset,
  arcLength,
  arcLengthAt,
  arcPath,
  arcRadius,
  completionPercent,
  describeArc,
  fillPercent,
  GAUGE_ARC_BOX,
  GAUGE_ARC_CENTER,
  GAUGE_ARC_PATH_LENGTH,
  GAUGE_ARC_SPAN_DEFAULT,
  GAUGE_ARC_SPAN_MAX,
  GAUGE_ARC_SPAN_MIN,
  GAUGE_TICK_COUNT_DEFAULT,
  GAUGE_TICK_COUNT_MAX,
  GAUGE_TICK_COUNT_MIN,
  isFillVisible,
  labelAnchorShift,
  normalizePercent,
  polarToCartesian,
  resolveThickness,
  tickPercents,
} from '../../../src/modules/gauge-card/geometry'
import { GAUGE_SHAPE_VALUES } from '../../../src/modules/gauge-card/options'

/** `d` 串里 `A` 指令的大弧标志：`M x y A r r 0 <标志> 1 x y`。 */
function largeArcFlag(path: string): string | undefined {
  return path.split(' ')[7]
}

describe('量程 → 百分比', () => {
  it('读数落在量程里就是那个百分比，两端各夹一次', () => {
    expect(normalizePercent(50, 0, 100)).toBe(50)
    expect(normalizePercent(25, 20, 30)).toBe(50)
    expect(normalizePercent(0, 0, 100)).toBe(0)
    expect(normalizePercent(150, 0, 100)).toBe(100)
    expect(normalizePercent(-10, 0, 100)).toBe(0)
  })

  it('缺值、非数与数字字符串一律 null——不是 0%', () => {
    expect(normalizePercent(null, 0, 100)).toBeNull()
    expect(normalizePercent(undefined, 0, 100)).toBeNull()
    expect(normalizePercent('42', 0, 100)).toBeNull()
    expect(normalizePercent(Number.NaN, 0, 100)).toBeNull()
  })

  it('量程非法给 null，不除零也不把上界伪造成下界加一百', () => {
    expect(normalizePercent(50, 100, 100)).toBeNull()
    expect(normalizePercent(50, 100, 0)).toBeNull()
    expect(normalizePercent(50, 0, Number.NaN)).toBeNull()
  })
})

describe('完成率不夹', () => {
  it('值除目标可以超过一百', () => {
    expect(completionPercent(96, 80, 96)).toBe(120)
  })

  it('目标缺失、为零或写成字符串时退回量程口径，不返回 0', () => {
    expect(completionPercent(50, null, 50)).toBe(50)
    expect(completionPercent(50, 0, 50)).toBe(50)
    expect(completionPercent(50, '80', 50)).toBe(50)
  })

  it('没有读数时整条给 null', () => {
    expect(completionPercent(null, 80, 42)).toBeNull()
    expect(completionPercent(96, null, null)).toBeNull()
  })
})

describe('填充比例', () => {
  it('缺值与非数当零，负数与超量程各夹一次', () => {
    expect(fillPercent(null)).toBe(0)
    expect(fillPercent(Number.NaN)).toBe(0)
    expect(fillPercent(42.5)).toBe(42.5)
    expect(fillPercent(-3)).toBe(0)
    expect(fillPercent(250)).toBe(100)
  })

  it('真实的零不画填充，一丝也算画', () => {
    expect(isFillVisible(null)).toBe(false)
    expect(isFillVisible(0)).toBe(false)
    expect(isFillVisible(0.01)).toBe(true)
  })
})

describe('厚度的「零 = 随形状」', () => {
  it('三档吃厚度的各有缺省，储罐与温度计不吃厚度', () => {
    expect(resolveThickness('arc', 0)).toBe(9)
    expect(resolveThickness('linear', 0)).toBe(12)
    expect(resolveThickness('track', 0)).toBe(18)
    expect(resolveThickness('tank', 0)).toBe(0)
    expect(resolveThickness('thermometer', 0)).toBe(0)
  })

  it('清空输入框的三种落库形态同义：零、负数、非有限数都回缺省', () => {
    expect(resolveThickness('arc', -5)).toBe(9)
    expect(resolveThickness('arc', Number.NaN)).toBe(9)
    expect(resolveThickness('linear', Number.POSITIVE_INFINITY)).toBe(12)
  })

  it('配了就钳进区间，不许塌成看不见也不许粗到出框', () => {
    expect(resolveThickness('arc', 1)).toBe(2)
    expect(resolveThickness('arc', 99)).toBe(24)
    expect(resolveThickness('arc', 12)).toBe(12)
  })

  it('五档形状一档不漏，缺一档就是 undefined 塞进 SVG', () => {
    for (const shape of GAUGE_SHAPE_VALUES) {
      expect([shape, Number.isFinite(resolveThickness(shape, 0))]).toEqual([
        shape,
        true,
      ])
    }
  })
})

describe('极坐标', () => {
  it('零度在正上方、顺时针递增', () => {
    const top = polarToCartesian(50, 50, 40, 0)
    const right = polarToCartesian(50, 50, 40, 90)
    const bottom = polarToCartesian(50, 50, 40, 180)
    const left = polarToCartesian(50, 50, 40, 270)

    expect(top.x).toBeCloseTo(50, 6)
    expect(top.y).toBeCloseTo(10, 6)
    expect(right.x).toBeCloseTo(90, 6)
    expect(right.y).toBeCloseTo(50, 6)
    expect(bottom.y).toBeCloseTo(90, 6)
    expect(left.x).toBeCloseTo(10, 6)
  })
})

describe('张角 → 起止角', () => {
  it('缺口永远在正下方居中，两百七十度就是参考仓那一对角', () => {
    expect(arcAngles(GAUGE_ARC_SPAN_DEFAULT)).toEqual({ start: 225, end: 495 })
    expect(arcAngles(180)).toEqual({ start: 270, end: 450 })
    expect(arcAngles(300)).toEqual({ start: 210, end: 510 })
  })

  it('张角钳进区间，非有限数回落缺省', () => {
    expect(arcAngles(10)).toEqual(arcAngles(GAUGE_ARC_SPAN_MIN))
    expect(arcAngles(720)).toEqual(arcAngles(GAUGE_ARC_SPAN_MAX))
    expect(arcAngles(Number.NaN)).toEqual(arcAngles(GAUGE_ARC_SPAN_DEFAULT))
  })

  it('张角永远画得出来：满一圈时起点与终点重合，一条弧指令只剩一个点', () => {
    for (const span of [0, 180, 270, 360, 1000]) {
      const { start, end } = arcAngles(span)

      expect([span, end - start < 360]).toEqual([span, true])
    }
  })
})

describe('描弧', () => {
  it('大弧标志跟着张角翻——超过半圈还写零，画出来是短的那一边', () => {
    expect(largeArcFlag(describeArc(50, 50, 40, 0, 180))).toBe('0')
    expect(largeArcFlag(describeArc(50, 50, 40, 0, 180.1))).toBe('1')
    expect(largeArcFlag(describeArc(50, 50, 40, 0, 181))).toBe('1')
    expect(largeArcFlag(describeArc(50, 50, 40, 225, 495))).toBe('1')
  })

  it('起止角超过一圈或倒着写也按同一个圈内张角判', () => {
    expect(largeArcFlag(describeArc(50, 50, 40, 585, 855))).toBe('1')
    expect(largeArcFlag(describeArc(50, 50, 40, 0, -90))).toBe('1')
    expect(largeArcFlag(describeArc(50, 50, 40, 0, -350))).toBe('0')
  })

  it('坐标取到三位小数，浮点尘埃不进 d 串', () => {
    expect(describeArc(50, 50, 44.5, 225, 495)).toBe(
      'M 18.534 81.466 A 44.5 44.5 0 1 1 81.466 81.466',
    )
  })
})

describe('弧度盘那一整条', () => {
  it('圆心在画布正中，半径按厚度收缩到不顶边', () => {
    expect(GAUGE_ARC_CENTER).toBe(GAUGE_ARC_BOX / 2)
    expect(arcRadius(0)).toBe(44.5)
    expect(arcRadius(12)).toBe(43)
    expect(arcRadius(24)).toBe(37)
    expect(arcRadius(0) + resolveThickness('arc', 0) / 2).toBeLessThan(
      GAUGE_ARC_CENTER,
    )
  })

  it('缺省厚度与缺省张角画出参考仓那条弧', () => {
    expect(arcPath(0, GAUGE_ARC_SPAN_DEFAULT)).toBe(
      'M 18.534 81.466 A 44.5 44.5 0 1 1 81.466 81.466',
    )
  })

  it('半圈那一档正好落在大弧标志的翻转点上', () => {
    expect(arcPath(0, 180)).toBe('M 5.5 50 A 44.5 44.5 0 0 1 94.5 50')
  })

  it('填充走归一长度：没有读数时整条藏起来', () => {
    expect(arcDashOffset(null)).toBe(GAUGE_ARC_PATH_LENGTH)
    expect(arcDashOffset(0)).toBe(100)
    expect(arcDashOffset(68)).toBe(32)
    expect(arcDashOffset(120)).toBe(0)
  })

  it('弧上按百分比取角：起点、正中与终点', () => {
    expect(arcAngleAt(0, 270)).toBe(225)
    expect(arcAngleAt(50, 270)).toBe(360)
    expect(arcAngleAt(100, 270)).toBe(495)
    expect(arcAngleAt(null, 270)).toBe(225)
  })

  it('真实弧长按半径与张角算，取一段就按百分比截', () => {
    expect(arcLength(44.5, 270)).toBeCloseTo(209.701, 3)
    expect(arcLength(44.5, 180)).toBeCloseTo(139.801, 3)
    expect(arcLengthAt(44.5, 270, 50)).toBeCloseTo(104.851, 3)
    expect(arcLengthAt(44.5, 270, null)).toBe(0)
  })
})

describe('刻度与贴边标签', () => {
  it('等距刻度首尾各占一个', () => {
    const four = tickPercents(GAUGE_TICK_COUNT_DEFAULT)

    expect(four).toHaveLength(4)
    expect(four[0]).toBe(0)
    expect(four[1]).toBeCloseTo(100 / 3, 6)
    expect(four[3]).toBe(100)
    expect(tickPercents(2)).toEqual([0, 100])
  })

  it('刻度个数钳进区间：一个刻度会让分母塌成零，整排全是 NaN', () => {
    expect(tickPercents(1)).toEqual(tickPercents(GAUGE_TICK_COUNT_MIN))
    expect(tickPercents(99)).toHaveLength(GAUGE_TICK_COUNT_MAX)
    expect(tickPercents(Number.NaN)).toHaveLength(GAUGE_TICK_COUNT_DEFAULT)
    expect(tickPercents(4.6)).toHaveLength(5)
    expect(tickPercents(99).every((tick) => Number.isFinite(tick))).toBe(true)
  })

  it('两端换对齐基准，居中的那一半才不会被卡片裁掉', () => {
    expect(labelAnchorShift(null)).toBe('0')
    expect(labelAnchorShift(0)).toBe('0')
    expect(labelAnchorShift(2)).toBe('0')
    expect(labelAnchorShift(2.1)).toBe('-50%')
    expect(labelAnchorShift(50)).toBe('-50%')
    expect(labelAnchorShift(97.9)).toBe('-50%')
    expect(labelAnchorShift(98)).toBe('-100%')
    expect(labelAnchorShift(150)).toBe('-100%')
  })

  it('四个刻度的基准与参考仓按下标那套逐个相同', () => {
    expect(tickPercents(4).map(labelAnchorShift)).toEqual([
      '0',
      '-50%',
      '-50%',
      '-100%',
    ])
  })
})
