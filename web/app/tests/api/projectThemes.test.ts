/**
 * @fileoverview 契约：项目自定义主题的 URL 形状与明暗档的闭合窄化。
 *
 * ⚠ `mode` 决定这套配色按深色还是浅色的对比度口径校验，认不出就抛：
 * 静默按某一档处理会让整套主题看上去正常而实际全不达标。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as themes from '@/api/projectThemes'
import { toProjectTheme } from '@/api/projectThemesWire'

const PLATFORM_PREFIX = '/api/v1/platform'
const TOKENS = { accent: { primary: '#3b82f6' } }

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({
    id: 'th1',
    name: '深蓝',
    mode: 'dark',
    tokens: TOKENS,
  })
  vi.spyOn(client, 'request').mockImplementation(requestMock)
  vi.spyOn(client, 'requestData').mockImplementation(requestMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function call(): [string, Record<string, unknown>] {
  const args = requestMock.mock.calls.at(-1)
  return [args?.[0] as string, (args?.[1] ?? {}) as Record<string, unknown>]
}

describe('线形映射', () => {
  it('四个字段原样带过来，明暗档窄化成闭合集合里的值', () => {
    expect(
      toProjectTheme({ id: 'th1', name: '深蓝', mode: 'dark', tokens: TOKENS }),
    ).toEqual({ id: 'th1', name: '深蓝', mode: 'dark', tokens: TOKENS })
  })

  it('认不出的明暗档当场抛', () => {
    expect(() =>
      toProjectTheme({ id: 'th1', name: '深蓝', mode: 'darkk', tokens: {} }),
    ).toThrow(client.TransportError)
  })

  it('token 不是对象时给空对象，由主题引擎回退到内置默认', () => {
    expect(
      toProjectTheme({ id: 'th1', name: '深蓝', mode: 'light', tokens: null })
        .tokens,
    ).toEqual({})
  })
})

describe('增删改查', () => {
  it('列表是项目下的子资源，打在 platform 前缀上', async () => {
    requestMock.mockResolvedValueOnce([
      { id: 'th1', name: '深蓝', mode: 'dark', tokens: TOKENS },
    ])
    const list = await themes.listProjectThemes('p1')
    const [path, options] = call()

    expect(path).toBe('/dashboard-projects/p1/themes')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(list).toHaveLength(1)
  })

  it('新建走 POST 并带幂等键', async () => {
    await themes.createProjectTheme(
      'p1',
      { name: '深蓝', mode: 'dark', tokens: TOKENS },
      'key-1',
    )
    const [path, options] = call()

    expect(path).toBe('/dashboard-projects/p1/themes')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({ name: '深蓝', mode: 'dark', tokens: TOKENS })
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
  })

  it('改只发给了的那几项', async () => {
    await themes.updateProjectTheme('p1', 'th1', { name: '改过' })
    const [path, options] = call()

    expect(path).toBe('/dashboard-projects/p1/themes/th1')
    expect(options.method).toBe('PATCH')
    expect(options.body).toEqual({ name: '改过' })
  })

  it('整份替换 token 时把整组发过去，不做逐键合并', async () => {
    await themes.updateProjectTheme('p1', 'th1', {
      mode: 'light',
      tokens: TOKENS,
    })

    expect(call()[1].body).toEqual({ mode: 'light', tokens: TOKENS })
  })

  it('删除走 DELETE', async () => {
    await themes.deleteProjectTheme('p1', 'th1')
    const [path, options] = call()

    expect(path).toBe('/dashboard-projects/p1/themes/th1')
    expect(options.method).toBe('DELETE')
  })
})

describe('错误码', () => {
  it('主题不存在有自己的码，按码分支不按文案', () => {
    expect(themes.THEME_NOT_FOUND_CODE).toBe(41019)
  })
})
