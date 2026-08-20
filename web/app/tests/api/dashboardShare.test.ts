/**
 * @fileoverview 契约：发布 / 取消发布的动作端点与幂等键，公开端点必须匿名发。
 *
 * ⚠ 公开端点带上过期令牌会先撞 401 再走刷新，而这条路径本就允许没登录，
 * 刷新失败还会把当前会话踢下线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as share from '@/api/dashboardShare'
import {
  toPublicBinding,
  toPublicDashboard,
  toPublicNode,
  toPublication,
} from '@/api/dashboardShareWire'

const PLATFORM_PREFIX = '/api/v1/platform'

let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi.fn().mockResolvedValue({
    id: 'db1',
    is_public: true,
    public_token: 'tok-new',
    name: '总览',
    description: null,
    design_width: 1920,
    design_height: 1080,
    schema_version: 1,
    theme_json: {},
    chrome_json: {},
    nodes: [],
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

const UPDATED_AT = '2026-08-17T00:00:00.000Z'

describe('线形映射', () => {
  it('发布态字段名转成 camelCase', () => {
    expect(
      toPublication({
        dashboard_id: 'db1',
        is_public: true,
        public_token: 'tok',
        updated_at: UPDATED_AT,
      }),
    ).toEqual({ dashboardId: 'db1', isPublic: true, publicToken: 'tok' })
  })

  it('撤回后令牌是 null，不是空串——空串会被当成一条能用的链接拼出去', () => {
    expect(
      toPublication({
        dashboard_id: 'db1',
        is_public: false,
        public_token: null,
        updated_at: UPDATED_AT,
      }).publicToken,
    ).toBeNull()
  })

  // ⚠ 这份夹具照抄后端 `PublicDashboardOut` / `PublicNodeOut` 的**真实字段**：
  // 没有屏的 `id`，节点没有 `dashboard_id` / `created_at` / `updated_at`。
  // 早先这里按管理面的形状写，于是映射复用了 `toNode`、三个字段恒为 undefined，
  // 而 typecheck 全绿——线形是我们自己声明的，网络那头进来的是 unknown。
  it('公开视图按后端的真实形状转，每个字段都落到位', () => {
    const payload = toPublicDashboard({
      name: '总览',
      description: null,
      design_width: 1920,
      design_height: 1080,
      schema_version: 1,
      theme_json: { accent: '#101010' },
      chrome_json: {},
      updated_at: '2026-08-14T07:00:00Z',
      nodes: [
        {
          id: 'n1',
          parent_id: null,
          client_key: null,
          module_type: 'demo',
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          z_index: 0,
          is_visible: true,
          config_json: {},
          bindings: [],
        },
      ],
    })

    expect(payload).toMatchObject({
      designWidth: 1920,
      schemaVersion: 1,
      themeJson: { accent: '#101010' },
      updatedAt: '2026-08-14T07:00:00Z',
    })
    expect(payload.nodes[0]?.moduleType).toBe('demo')
    // 公开面不回任何能定位它在库里位置的信息（ADR-0014）
    expect('id' in payload).toBe(false)
    expect('projectId' in payload).toBe(false)
    expect('rowVersion' in payload).toBe(false)
  })

  it('公开节点上不会凭空多出管理面才有的字段', () => {
    const node = toPublicNode({
      id: 'n1',
      parent_id: null,
      client_key: null,
      module_type: 'demo',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      z_index: 0,
      is_visible: true,
      config_json: {},
      bindings: [],
    })

    // 复用 toNode 时这三个键会以 undefined 的形式存在，一路静默流到渲染层
    expect('dashboardId' in node).toBe(false)
    expect('createdAt' in node).toBe(false)
    expect('updatedAt' in node).toBe(false)
  })

  // 绑定这一层同样比管理面窄：`PublicBindingOut` 没有 node_id/created_at/updated_at
  it('公开绑定逐字段转，也不凭空多出管理面才有的字段', () => {
    const binding = toPublicBinding({
      id: 'b1',
      field_key: 'value',
      source_kind: 'opcua',
      node_key: 's1:t1',
      static_value_json: null,
      compute_json: null,
      detail_json: null,
      transform_json: { scale: 2, offset: null, round: 1 },
    })

    expect(binding).toEqual({
      id: 'b1',
      fieldKey: 'value',
      sourceKind: 'opcua',
      nodeKey: 's1:t1',
      staticValueJson: null,
      computeJson: null,
      detailJson: null,
      transformJson: { scale: 2, offset: null, round: 1 },
    })
    expect('nodeId' in binding).toBe(false)
    expect('createdAt' in binding).toBe(false)
    expect('updatedAt' in binding).toBe(false)
  })

  it('公开绑定认不出的来源当场抛，与管理面同一套闭合窄化', () => {
    expect(() =>
      toPublicBinding({
        id: 'b1',
        field_key: 'value',
        source_kind: 'opuca',
        node_key: null,
        static_value_json: null,
        compute_json: null,
        detail_json: null,
        transform_json: null,
      }),
    ).toThrow(client.TransportError)
  })
})

describe('读当前发布态', () => {
  it('是发布面下的子资源读，不是动作端点，也不带幂等键', async () => {
    const publication = await share.getDashboardPublication('db1')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1/publication')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(options.method).toBeUndefined()
    expect(options.headers).toBeUndefined()
    expect(publication.publicToken).toBe('tok-new')
  })

  it('带取消信号时把它透下去，关掉弹窗就掐得掉在途那次', async () => {
    const controller = new AbortController()
    await share.getDashboardPublication('db1', controller.signal)

    expect(call()[1].signal).toBe(controller.signal)
  })

  it('不给取消信号时不往请求里塞一个 undefined', async () => {
    await share.getDashboardPublication('db1')

    expect('signal' in call()[1]).toBe(false)
  })
})

describe('发布与撤回', () => {
  it('发布是动作端点，带幂等键，出参给出这一次的新令牌', async () => {
    const published = await share.publishDashboard('db1', 'key-1')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1:publish')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-1' })
    expect(published.publicToken).toBe('tok-new')
  })

  it('撤回也是动作端点，也带幂等键', async () => {
    await share.unpublishDashboard('db1', 'key-2')
    const [path, options] = call()

    expect(path).toBe('/dashboards/db1:unpublish')
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Idempotency-Key': 'key-2' })
  })
})

describe('公开只读', () => {
  it('按令牌取，且必须匿名发', async () => {
    const payload = await share.getPublicDashboard('tok-1')
    const [path, options] = call()

    expect(path).toBe('/public-dashboards/tok-1')
    expect(options.baseUrl).toBe(PLATFORM_PREFIX)
    expect(options.anonymous).toBe(true)
    expect(payload.name).toBe('总览')
  })

  it('带取消信号时把它透下去，切页时掐得掉在途请求', async () => {
    const controller = new AbortController()
    await share.getPublicDashboard('tok-1', controller.signal)

    expect(call()[1].signal).toBe(controller.signal)
  })

  it('不给取消信号时不往请求里塞一个 undefined', async () => {
    await share.getPublicDashboard('tok-1')

    expect('signal' in call()[1]).toBe(false)
  })
})

describe('错误码', () => {
  it('令牌查不到有自己的码；撤回过的与从来没有的都是这一个，不区分', () => {
    expect(share.DASHBOARD_NOT_PUBLISHED_CODE).toBe(41016)
  })
})
