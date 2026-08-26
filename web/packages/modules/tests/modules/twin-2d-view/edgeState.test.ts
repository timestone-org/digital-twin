/**
 * @fileoverview 守连线取值归一的两张词表：真假词、流向词，以及「原生 boolean 不表方向」
 * 那条反直觉的规矩。词表逐字取自参考项目（docs/MODULE_TWIN_2D_DESIGN.md §7.12 #97）。
 */
import { describe, expect, it } from 'vitest'

import {
  boolFromValue,
  reverseFromValue,
} from '../../../src/modules/twin-2d-view/edgeState'

const TRUTHY_WORDS = [
  '1',
  'true',
  'on',
  'open',
  'run',
  'running',
  'active',
  'enable',
  'enabled',
  'yes',
  'y',
]

const FALSY_WORDS = [
  '0',
  'false',
  'off',
  'close',
  'closed',
  'stop',
  'stopped',
  'inactive',
  'disable',
  'disabled',
  'no',
  'n',
]

const REVERSE_WORDS = [
  'reverse',
  'reversed',
  'backward',
  'back',
  'rev',
  'ccw',
  'left',
  '反向',
  '逆向',
]

const FORWARD_WORDS = [
  'forward',
  'forwards',
  'normal',
  'front',
  'fwd',
  'cw',
  'right',
  '正向',
  '顺向',
]

describe('活跃词表', () => {
  it('十一个真词全认，且不挑大小写与首尾空白', () => {
    const read = TRUTHY_WORDS.map((word) => boolFromValue(` ${word} `, false))

    expect(read).toEqual(TRUTHY_WORDS.map(() => true))
    expect(boolFromValue('RUNNING', false)).toBe(true)
  })

  it('十二个假词全认', () => {
    expect(FALSY_WORDS.map((word) => boolFromValue(word, true))).toEqual(
      FALSY_WORDS.map(() => false),
    )
  })

  it('原生 boolean 原样返回', () => {
    expect([boolFromValue(true, false), boolFromValue(false, true)]).toEqual([
      true,
      false,
    ])
  })

  it('数字按零与非零判', () => {
    expect([boolFromValue(0, true), boolFromValue(-2, false)]).toEqual([
      false,
      true,
    ])
  })

  /**
   * ⚠ 读不懂的一个值不该把一条本来活跃的连线画成灰的：「看不懂」与「确实没流」
   * 是两件事，所以认不出的非空值回落调用方给的缺省。
   */
  it('认不出的非空词回落缺省', () => {
    expect([
      boolFromValue('说不好', true),
      boolFromValue('说不好', false),
    ]).toEqual([true, false])
  })

  it('空值、空串与不是字符串的脏值一律回落缺省', () => {
    const read = [null, undefined, '', '   ', { a: 1 }].map((raw) =>
      boolFromValue(raw, true),
    )

    expect(read).toEqual([true, true, true, true, true])
  })
})

describe('流向词表', () => {
  /**
   * ⚠ 这条反直觉，专门守：设备的 on/off 表达的是「这条管路通不通」而不是
   * 「往哪边流」，把 `false` 读成反向会让每一条停掉的连线上箭头集体掉头。
   */
  it('原生 boolean 一律不表方向', () => {
    expect([reverseFromValue(true), reverseFromValue(false)]).toEqual([
      false,
      false,
    ])
  })

  it('数字只有负数才算反向，零不算', () => {
    const read = [-0.5, 0, 3].map((raw) => reverseFromValue(raw))

    expect(read).toEqual([true, false, false])
  })

  it('数字串先当数字读，不去查词表', () => {
    const read = ['-1', ' -2.5 ', '4', '0'].map((raw) => reverseFromValue(raw))

    expect(read).toEqual([true, true, false, false])
  })

  it('九个反向词全认', () => {
    expect(REVERSE_WORDS.map((word) => reverseFromValue(word))).toEqual(
      REVERSE_WORDS.map(() => true),
    )
  })

  it('九个正向词全认，且不挑大小写', () => {
    expect(FORWARD_WORDS.map((word) => reverseFromValue(word))).toEqual(
      FORWARD_WORDS.map(() => false),
    )
    expect(reverseFromValue('Forward')).toBe(false)
  })

  it('认不出的词、空值与不是字符串的脏值都不算反向', () => {
    const read = [null, undefined, '', '  ', '说不好', { a: 1 }].map((raw) =>
      reverseFromValue(raw),
    )

    expect(read).toEqual([false, false, false, false, false, false])
  })
})
