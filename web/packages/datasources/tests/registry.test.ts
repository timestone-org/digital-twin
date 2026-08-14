/**
 * @fileoverview 契约：注册表是「加一种取数方式 = 一行注册」的那条缝，
 * 且未登记的来源必须抛而不是返回 undefined——静默的 undefined 会表现成
 * 「绑了点位但永远没数据」。
 */
import type { BindingSourceKind, DataSourceProvider } from '@dt/contracts'
import { beforeEach, describe, expect, it } from 'vitest'

import { DataSourceError } from '../src/errors'
import {
  __resetProviders,
  getProvider,
  hasProvider,
  listProviders,
  providerRegistry,
  registerProvider,
} from '../src/registry'

function fakeProvider(kind: BindingSourceKind): DataSourceProvider {
  return {
    kind,
    subscribe: () => () => undefined,
    readHistory: () =>
      Promise.resolve({ points: [], isTruncated: false, isStale: false }),
  }
}

function caught(run: () => unknown): unknown {
  try {
    run()
    return null
  } catch (error) {
    return error
  }
}

beforeEach(() => {
  __resetProviders()
})

describe('provider 注册表', () => {
  it('登记过的来源按种类取回同一个实现', () => {
    const provider = fakeProvider('opcua')
    registerProvider(provider)

    expect(getProvider('opcua')).toBe(provider)
  })

  it('同一种来源重复登记以后者为准', () => {
    registerProvider(fakeProvider('static'))
    const next = fakeProvider('static')
    registerProvider(next)

    expect(getProvider('static')).toBe(next)
    expect(listProviders()).toHaveLength(1)
  })

  it('未登记的来源取用时抛出 unknown-source-kind', () => {
    expect(() => getProvider('archive')).toThrow(DataSourceError)
    expect(caught(() => getProvider('archive'))).toMatchObject({
      code: 'unknown-source-kind',
    })
  })

  it('未登记的来源用 hasProvider 问不抛也不误报', () => {
    expect(hasProvider('computed')).toBe(false)
    registerProvider(fakeProvider('computed'))
    expect(hasProvider('computed')).toBe(true)
  })

  it('列出全部 provider 时按登记先后给出副本', () => {
    const first = fakeProvider('opcua')
    const second = fakeProvider('archive')
    registerProvider(first)
    registerProvider(second)

    const listed = listProviders()
    expect(listed).toEqual([first, second])

    const copy = [...listed]
    copy.pop()
    expect(listProviders()).toHaveLength(2)
  })

  it('清空之后一个来源都不认', () => {
    registerProvider(fakeProvider('static'))
    __resetProviders()

    expect(listProviders()).toEqual([])
    expect(hasProvider('static')).toBe(false)
  })
})

describe('contracts 口径的注册表面', () => {
  it('与模块级函数共用同一份登记', () => {
    const provider = fakeProvider('opcua')
    providerRegistry.register(provider)

    expect(getProvider('opcua')).toBe(provider)
    expect(providerRegistry.get('opcua')).toBe(provider)
  })

  it('未登记的来源按契约返回 undefined，交由求值层给出 error 槽', () => {
    expect(providerRegistry.get('archive')).toBeUndefined()
  })

  it('reset 摘掉全部登记', () => {
    providerRegistry.register(fakeProvider('static'))
    providerRegistry.reset()

    expect(providerRegistry.get('static')).toBeUndefined()
  })
})
