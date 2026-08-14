/**
 * @fileoverview 守控件分发表：属性面板按表查而不是按 switch 分支，加一档控件
 * 只需注册一个组件；没登记的档取回 undefined，好让面板画出「还没有这档控件」
 * 而不是留一块「选了没反应」的空白。
 */
import { CONFIG_FIELD_TYPES } from '@dt/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import {
  __resetConfigControls,
  getConfigControl,
  listConfigControls,
  missingConfigControls,
  registerConfigControl,
} from '../src/configControls'

const STRING_CONTROL = { template: '<input />' }
const NUMBER_CONTROL = { template: '<input type="number" />' }

afterEach(() => {
  __resetConfigControls()
})

describe('控件分发表', () => {
  it('登记后按字段类型取回同一个组件', () => {
    registerConfigControl('string', STRING_CONTROL)

    expect(getConfigControl('string')).toBe(STRING_CONTROL)
  })

  it('没登记的档取回 undefined', () => {
    expect(getConfigControl('color')).toBeUndefined()
  })

  it('同一档后登记者生效', () => {
    registerConfigControl('string', STRING_CONTROL)
    registerConfigControl('string', NUMBER_CONTROL)

    expect(getConfigControl('string')).toBe(NUMBER_CONTROL)
  })

  it('已登记档位的顺序就是登记先后', () => {
    registerConfigControl('number', NUMBER_CONTROL)
    registerConfigControl('string', STRING_CONTROL)

    expect(listConfigControls()).toEqual(['number', 'string'])
  })

  it('未登记档位逐一列得出来', () => {
    registerConfigControl('string', STRING_CONTROL)

    expect(missingConfigControls()).not.toContain('string')
    expect(missingConfigControls()).toContain('color')
  })

  it('闭合联合里每一档都登记后，缺口列表是空的', () => {
    for (const type of CONFIG_FIELD_TYPES) {
      registerConfigControl(type, STRING_CONTROL)
    }

    expect(missingConfigControls()).toEqual([])
  })

  it('复位后分发表是空的', () => {
    registerConfigControl('string', STRING_CONTROL)

    __resetConfigControls()

    expect(listConfigControls()).toEqual([])
  })
})
