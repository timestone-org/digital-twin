/**
 * @fileoverview 契约：常量绑定里 `0` / `false` / `''` 都是值，只有没配过才算
 * 取不到；常量没有点位可订阅、也没有历史，两者都必须响亮失败。
 */
import { describe, expect, it } from 'vitest'

import {
  createStaticProvider,
  resolveStaticValue,
} from '../../src/static/provider'

describe('常量取值', () => {
  it('落值一律原样带出', () => {
    expect(resolveStaticValue('运行中')).toEqual({
      state: 'ok',
      value: '运行中',
    })
  })

  it('0 与 false 与空串都是合法常量', () => {
    expect(resolveStaticValue(0)).toEqual({ state: 'ok', value: 0 })
    expect(resolveStaticValue(false)).toEqual({ state: 'ok', value: false })
    expect(resolveStaticValue('')).toEqual({ state: 'ok', value: '' })
  })

  it('没配过值时给 error 槽而不是 undefined', () => {
    const slot = resolveStaticValue(undefined)

    expect(slot.state).toBe('error')
    expect(slot).toMatchObject({ error: { code: 'missing-static-value' } })
  })

  it('落库的 null 同样算没配过', () => {
    expect(resolveStaticValue(null)).toMatchObject({
      state: 'error',
      error: { code: 'missing-static-value' },
    })
  })
})

describe('常量 provider', () => {
  it('认 static 这一种来源', () => {
    expect(createStaticProvider().kind).toBe('static')
  })

  it('拿点位来订阅时说破这条绑定接错了来源', () => {
    expect(() =>
      createStaticProvider().subscribe(['src-1:temp'], () => undefined),
    ).toThrowError(/没有可订阅的点位/)
  })

  it('一个点位都没有时给一个可安全调用的退订', () => {
    const stop = createStaticProvider().subscribe([], () => undefined)

    expect(stop()).toBeUndefined()
  })

  it('读历史一律拒绝，不给空序列', async () => {
    await expect(
      createStaticProvider().readHistory({
        nodeKey: 'src-1:temp',
        range: { lastWindow: '1h' },
      }),
    ).rejects.toMatchObject({ code: 'unsupported-history' })
  })
})
