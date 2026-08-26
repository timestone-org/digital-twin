/**
 * @fileoverview 一步的入参与产出摊平。
 *
 * 守的是「看得见而且看得完」：截图不能混进文本产出（那是几十万字符的 base64），
 * 落库时包的那层壳要剥掉，超长的值要截断且说出来。
 */
import { describe, expect, it } from 'vitest'

import {
  MAX_KEYS,
  inputPreview,
  isImageOutput,
  outputPreview,
} from '@/features/ai/stepPreview'

describe('入参摊平', () => {
  it('没有入参给 null，不是一张空表', () => {
    expect(inputPreview(undefined)).toBeNull()
    expect(inputPreview({})).toBeNull()
    expect(inputPreview([1, 2])).toBeNull()
  })

  it('裸串不套引号', () => {
    expect(inputPreview({ node_id: 'n-1' })).toEqual({ node_id: 'n-1' })
  })

  it('嵌套的值摊成一行 JSON', () => {
    expect(inputPreview({ geometry: { x: 1 } })).toEqual({
      geometry: '{"x":1}',
    })
  })

  it('超长的值截断并说出来', () => {
    const flat = inputPreview({ text: '点'.repeat(900) })
    const value = flat?.text ?? ''
    expect(value.length).toBeLessThan(900)
    expect(value).toContain('已截断')
  })

  it('键太多时多出来的被数出来，不是悄悄没了', () => {
    const given: Record<string, number> = {}
    for (let at = 0; at < MAX_KEYS + 3; at += 1) given[`k${at}`] = at
    const flat = inputPreview(given)
    expect(Object.keys(flat ?? {})).toHaveLength(MAX_KEYS + 1)
    expect(Object.values(flat ?? {}).join()).toContain('另有 3 项未摊开')
  })
})

describe('产出摊平', () => {
  it('落库时包的那层 body 壳被剥掉', () => {
    expect(outputPreview({ body: '命中 3 条' })).toBe('命中 3 条')
  })

  it('没包壳的产出照样画得出来', () => {
    expect(outputPreview({ count: 3 })).toBe('{"count":3}')
  })

  it('截图不当成文本产出', () => {
    // 混进去的话，展开看到的是一坨 base64 而不是一张图
    expect(outputPreview('data:image/png;base64,AAAA')).toBeNull()
  })

  it('空的产出给 null', () => {
    expect(outputPreview(undefined)).toBeNull()
    expect(outputPreview(null)).toBeNull()
    expect(outputPreview('')).toBeNull()
  })

  it('超长产出截断并说出来', () => {
    const text = outputPreview({ body: '位'.repeat(5000) }) ?? ''
    expect(text.length).toBeLessThan(5000)
    expect(text).toContain('已截断')
  })
})

describe('认图', () => {
  it('只认 data:image/ 开头的', () => {
    expect(isImageOutput('data:image/png;base64,AA')).toBe(true)
    expect(isImageOutput('data:text/plain;base64,AA')).toBe(false)
    expect(isImageOutput({ url: 'data:image/png' })).toBe(false)
  })
})
