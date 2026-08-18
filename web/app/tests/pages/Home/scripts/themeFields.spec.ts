/**
 * @fileoverview 契约：自定义主题草稿与落库 tokens 之间的搬运——没覆盖过的项
 * 用内置默认回落，收敛回去只写登记过的那几项（不把整套 token 焊死进主题）。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_ID, getTheme } from '@dt/tokens'

import {
  MODE_OPTIONS,
  THEME_COLOR_FIELDS,
  buildTokens,
  readColors,
  readText,
  themeAccent,
} from '@/pages/Home/scripts/themeFields'

const DEFAULTS = getTheme(DEFAULT_THEME_ID).tokens

describe('读成编辑草稿', () => {
  it('库里没覆盖过的项用内置默认色，不是空串', () => {
    const draft = readColors(undefined)

    expect(draft['accent.primary']).toBe(DEFAULTS.accent.primary)
    expect(Object.keys(draft)).toHaveLength(THEME_COLOR_FIELDS.length)
  })

  it('库里覆盖过的项按库里的值回填', () => {
    const draft = readColors({ accent: { primary: '#123456' } })

    expect(draft['accent.primary']).toBe('#123456')
    expect(draft['state.danger']).toBe(DEFAULTS.state.danger)
  })

  it('形状对不上的 blob 当成没覆盖，而不是把它当颜色用', () => {
    const draft = readColors({ accent: '不是对象' })

    expect(draft['accent.primary']).toBe(DEFAULTS.accent.primary)
  })
})

describe('收敛回落库形状', () => {
  it('按组嵌套，且只写登记过的那几项', () => {
    const tokens = buildTokens(readColors({ accent: { primary: '#abcdef' } }))

    expect(tokens.accent).toEqual({
      primary: '#abcdef',
      secondary: DEFAULTS.accent.secondary,
    })
    expect(Object.keys(tokens).sort()).toEqual([
      'accent',
      'state',
      'surface',
      'text',
    ])
  })

  it('草稿里缺的项用回落值补齐，不写 undefined 进去', () => {
    const tokens = buildTokens({})

    expect(tokens.text).toEqual({ primary: DEFAULTS.text.primary })
  })
})

describe('列表与品牌字段的读取', () => {
  it('色点取主色，取不到时回落内置默认', () => {
    expect(themeAccent({ accent: { primary: '#0f0f0f' } })).toBe('#0f0f0f')
    expect(themeAccent({})).toBe(DEFAULTS.accent.primary)
  })

  it('非字符串的 blob 字段当成没写过', () => {
    expect(readText({ productName: 42 }, 'productName')).toBe('')
    expect(readText({ productName: '园区' }, 'productName')).toBe('园区')
  })

  it('明暗两档都给得出来', () => {
    expect(MODE_OPTIONS.map((option) => option.value)).toEqual([
      'dark',
      'light',
    ])
  })
})
