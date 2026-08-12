/**
 * @fileoverview 锁住 OPC UA 管理面接口的 URL 形状、方法、前缀与幂等键。
 *
 * ⚠ 动作端点的 `:verb` 写错不会有任何编译期报错，只会在运行时 404/405。
 * ⚠ 前缀写错会静默打到 auth-server 上——那边对未知路径回 404，
 * 现象是「这个功能没做」而不是「地址错了」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import * as opcua from '@/api/opcua'

const OPCUA_PREFIX = '/api/v1/opcua'

// ⚠ 两个入口都要打桩：取数走 requestData，204 的删除走 request
let requestMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  requestMock = vi
    .fn()
    .mockResolvedValue({ items: [], page: 1, size: 20, total: 0 })
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

describe('每一条请求都打在 opcua 前缀上', () => {
  it('取数与删除都带 baseUrl', async () => {
    await opcua.listInstances()
    expect(call()[1].baseUrl).toBe(OPCUA_PREFIX)
    await opcua.deleteInstance('i1')
    expect(call()[1].baseUrl).toBe(OPCUA_PREFIX)
  })
})

describe('实例', () => {
  it('列表带关键字与分页', async () => {
    await opcua.listInstances({ q: 'plant', page: 2, size: 50 })
    const [path, options] = call()
    expect(path).toBe('/instances')
    expect(options.query).toEqual({ q: 'plant', page: 2, size: 50 })
  })

  it('详情按 id 取', async () => {
    await opcua.getInstance('i1')
    expect(call()[0]).toBe('/instances/i1')
  })

  it('端口池是 instances 的子资源', async () => {
    await opcua.getPortPool()
    expect(call()[0]).toBe('/instances/port-pool')
  })

  it('创建走 POST 并带幂等键', async () => {
    await opcua.createInstance({
      name: 'plant',
      namespace_uri: 'urn:dt:plant',
      security_policies: ['NoSecurity'],
    })
    const [path, options] = call()
    expect(path).toBe('/instances')
    expect(options.method).toBe('POST')
    expect(options.headers).toHaveProperty('Idempotency-Key')
  })

  it('同一个幂等键重发时键不变——重试才不会建出第二个实例', async () => {
    const key = opcua.newIdempotencyKey()
    await opcua.createInstance(
      { name: 'a', namespace_uri: 'u', security_policies: ['NoSecurity'] },
      key,
    )
    const first = call()[1].headers
    await opcua.createInstance(
      { name: 'a', namespace_uri: 'u', security_policies: ['NoSecurity'] },
      key,
    )
    expect(call()[1].headers).toEqual(first)
  })

  it('更新走 PUT', async () => {
    await opcua.updateInstance('i1', { description: 'x' })
    const [path, options] = call()
    expect(path).toBe('/instances/i1')
    expect(options.method).toBe('PUT')
  })

  it('删除走 DELETE', async () => {
    await opcua.deleteInstance('i1')
    expect(call()[1].method).toBe('DELETE')
  })

  it.each(['start', 'stop', 'restart'] as const)(
    '动作端点 :%s 用冒号而不是子路径',
    async (verb) => {
      await opcua.actOnInstance('i1', verb)
      const [path, options] = call()
      expect(path).toBe(`/instances/i1:${verb}`)
      expect(options.method).toBe('POST')
    },
  )
})

describe('地址空间', () => {
  it('节点列表挂在实例下', async () => {
    await opcua.listNodes('i1', { q: 'temp' })
    const [path, options] = call()
    expect(path).toBe('/instances/i1/nodes')
    expect(options.query).toEqual({ q: 'temp' })
  })

  it('单个节点按 id 取', async () => {
    await opcua.getNode('i1', 'n1')
    expect(call()[0]).toBe('/instances/i1/nodes/n1')
  })

  it('建节点带幂等键', async () => {
    await opcua.createNode('i1', { identifier: 'T1', browse_name: 'T1' })
    const [path, options] = call()
    expect(path).toBe('/instances/i1/nodes')
    expect(options.method).toBe('POST')
    expect(options.headers).toHaveProperty('Idempotency-Key')
  })

  it('改节点走 PUT', async () => {
    await opcua.updateNode('i1', 'n1', { browse_name: 'x' })
    const [path, options] = call()
    expect(path).toBe('/instances/i1/nodes/n1')
    expect(options.method).toBe('PUT')
  })

  it('删节点走 DELETE', async () => {
    await opcua.deleteNode('i1', 'n1')
    const [path, options] = call()
    expect(path).toBe('/instances/i1/nodes/n1')
    expect(options.method).toBe('DELETE')
  })

  it('读值是节点的子资源', async () => {
    await opcua.readNodeValue('i1', 'n1')
    expect(call()[0]).toBe('/instances/i1/nodes/n1/value')
  })

  it('写值是动作端点，带幂等键，载荷包在 value 里', async () => {
    await opcua.writeNodeValue('i1', 'n1', 42)
    const [path, options] = call()
    expect(path).toBe('/instances/i1/nodes/n1:write')
    expect(options.method).toBe('POST')
    expect(options.body).toEqual({ value: 42 })
    expect(options.headers).toHaveProperty('Idempotency-Key')
  })

  it('写 false 与 0 不会被当成空值丢掉', async () => {
    await opcua.writeNodeValue('i1', 'n1', false)
    expect(call()[1].body).toEqual({ value: false })
    await opcua.writeNodeValue('i1', 'n1', 0)
    expect(call()[1].body).toEqual({ value: 0 })
  })
})

describe('会话、凭据与信任证书', () => {
  it('会话列表', async () => {
    await opcua.listSessions('i1')
    expect(call()[0]).toBe('/instances/i1/sessions')
  })

  it('凭据的增删查', async () => {
    await opcua.listCredentials('i1')
    expect(call()[0]).toBe('/instances/i1/credentials')
    await opcua.createCredential('i1', { username: 'scada' })
    const [path, options] = call()
    expect(path).toBe('/instances/i1/credentials')
    expect(options.body).toEqual({ username: 'scada' })
    await opcua.deleteCredential('i1', 'c1')
    expect(call()[0]).toBe('/instances/i1/credentials/c1')
  })

  it('信任证书用 kebab-case 的资源名', async () => {
    await opcua.listTrustedCertificates('i1')
    expect(call()[0]).toBe('/instances/i1/trusted-certificates')
    await opcua.addTrustedCertificate('i1', '-----BEGIN CERTIFICATE-----')
    expect(call()[1].body).toEqual({
      certificate_pem: '-----BEGIN CERTIFICATE-----',
    })
    await opcua.deleteTrustedCertificate('i1', 'x1')
    expect(call()[0]).toBe('/instances/i1/trusted-certificates/x1')
  })
})

describe('幂等键', () => {
  it('每次生成都不同', () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => opcua.newIdempotencyKey()),
    )
    expect(keys.size).toBe(200)
  })

  it('⚠ 不依赖 crypto.randomUUID——纯 HTTP 的内网地址上它不存在', () => {
    const original = Reflect.get(globalThis, 'crypto')
    Reflect.deleteProperty(globalThis, 'crypto')
    try {
      expect(opcua.newIdempotencyKey()).not.toBe('')
    } finally {
      Reflect.set(globalThis, 'crypto', original)
    }
  })
})
