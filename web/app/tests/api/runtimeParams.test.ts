/**
 * @fileoverview 契约：运行参数的 URL 形状与 section 的闭合窄化。
 *
 * ⚠ 「恢复默认」是删掉覆盖行的动作端点，不是写回一份默认值：环境变量是永久
 * 默认值，抄一份进库之后运维改 .env 就再也不生效了。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as runtimeParams from '@/api/runtimeParams'
import { toRuntimeParamItem } from '@/api/runtimeParamsWire'

const PLATFORM_PREFIX = '/api/v1/platform'

// ⚠ 字段名以 openapi 的 RuntimeParamOut 为准（default_value / is_overridden）：
// 此前这里的假件写的是 `default` / `overridden`，与后端从未一致——假件与线形
// 一起漂，单测因此全绿而弹窗在真环境里读不到默认值
const ITEM_WIRE = {
  section: 'dashboard',
  key: 'publish_window_ms',
  env_name: 'PLATFORM_PUBLISH_WINDOW_MS',
  write_code: 'dashboard:edit',
  label: '发布节拍（毫秒）',
  hint: '发布循环多久醒一次。',
  kind: 'int',
  unit: 'ms',
  step: 100,
  minimum: 100,
  maximum: 60_000,
  tier: 'instant',
  danger: null,
  value: 500,
  default_value: 1000,
  previous_value: 1000,
  is_overridden: true,
  updated_by: 'admin',
  updated_at: '2026-08-14T00:00:00Z',
}

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue([ITEM_WIRE])
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
  it('字段名转成 camelCase，默认值落在 defaultValue 上', () => {
    expect(toRuntimeParamItem(ITEM_WIRE)).toEqual({
      section: 'dashboard',
      key: 'publish_window_ms',
      envName: 'PLATFORM_PUBLISH_WINDOW_MS',
      writeCode: 'dashboard:edit',
      label: '发布节拍（毫秒）',
      hint: '发布循环多久醒一次。',
      kind: 'int',
      unit: 'ms',
      step: 100,
      minimum: 100,
      maximum: 60_000,
      tier: 'instant',
      danger: null,
      value: 500,
      defaultValue: 1000,
      overridden: true,
      updatedBy: 'admin',
      updatedAt: '2026-08-14T00:00:00Z',
      previousValue: 1000,
    })
  })

  it('没被覆盖过的项，改动人与改动时刻是 null', () => {
    expect(
      toRuntimeParamItem({
        ...ITEM_WIRE,
        is_overridden: false,
        updated_by: null,
        updated_at: null,
        previous_value: null,
      }),
    ).toMatchObject({ overridden: false, updatedBy: null, updatedAt: null })
  })

  it('认不出的 section 当场抛——目录漂了会让人在错的页面上改错的旋钮', () => {
    expect(() =>
      toRuntimeParamItem({ ...ITEM_WIRE, section: 'dashboards' }),
    ).toThrow(client.TransportError)
  })
})

describe('读写与恢复默认', () => {
  it('读按 section 过滤，打在 platform 前缀上', async () => {
    const items = await runtimeParams.listRuntimeParams('dashboard')
    const [path, options] = call()

    expect(path).toBe('/runtime-params')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(options.query).toEqual({ section: 'dashboard' })
    expect(items[0]?.key).toBe('publish_window_ms')
  })

  it('写整组走 PUT，只提交要改的项', async () => {
    await runtimeParams.saveRuntimeParams('dashboard', {
      publish_window_ms: 500,
    })
    const [path, options] = call()

    expect(path).toBe('/runtime-params/dashboard')
    expect(options.method).toBe('PUT')
    expect(options.body).toEqual({ values: { publish_window_ms: 500 } })
  })

  it('恢复默认是动作端点 `:reset`，出参是恢复后的全量状态', async () => {
    const items = await runtimeParams.resetRuntimeParams('dashboard')
    const [path, options] = call()

    expect(path).toBe('/runtime-params/dashboard:reset')
    expect(options.method).toBe('POST')
    expect(items).toHaveLength(1)
  })
})

describe('采集分组走自己的路由', () => {
  it('collect / archive 打在 /collect-runtime-params 上——写码不同，发错前缀就是 400', async () => {
    await runtimeParams.listRuntimeParams('archive')
    const [listPath] = call()
    expect(listPath).toBe('/collect-runtime-params')

    await runtimeParams.saveRuntimeParams('archive', { enabled: false })
    const [savePath] = call()
    expect(savePath).toBe('/collect-runtime-params/archive')

    await runtimeParams.resetRuntimeParams('collect')
    const [resetPath] = call()
    expect(resetPath).toBe('/collect-runtime-params/collect:reset')
  })
})

describe('错误码', () => {
  it('提交了目录里没有的键有自己的码，按码分支不按文案', () => {
    expect(runtimeParams.RUNTIME_PARAM_UNKNOWN_CODE).toBe(41020)
  })
})
