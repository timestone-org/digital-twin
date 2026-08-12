/**
 * @fileoverview 把 `@dt/contracts` 的 opcua 类型钉在 opcua-server 的 openapi.json 上。
 *
 * 做法与 `openapi-shapes.contract.spec.ts` 同源，理由也同源：手写的类型比真接口
 * 宽松时，页面对着不存在的字段取值会拿到 undefined 并**崩在渲染里**，
 * 而 typecheck、lint、单测全绿——编译器无从发现后端改了字段名。
 *
 * `Record<keyof T, true>` 在**类型层**枚举一遍键（漏一个或多一个都过不了 vue-tsc），
 * 再把这份键集与 openapi 的 properties 比对。两头都锁住，中间就不会漂。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RequestOptions } from '@/api/client'
import type {
  OpcuaCertificate,
  OpcuaCredential,
  OpcuaCredentialCreated,
  OpcuaInstance,
  OpcuaInstanceAction,
  OpcuaNode,
  OpcuaNodeMutation,
  OpcuaNodeValue,
  OpcuaNodeWrite,
  OpcuaPortPool,
  OpcuaSession,
  OpcuaTrustedCertificate,
  Page,
} from '@dt/contracts'
import {
  OPCUA_DATA_TYPES,
  OPCUA_DESIRED_STATES,
  OPCUA_IDENTIFIER_KINDS,
  OPCUA_NODE_CLASSES,
  OPCUA_SECURITY_POLICIES,
} from '@dt/contracts'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'opcua-server',
  'openapi.json',
)

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  paths: Record<string, Record<string, unknown>>
  components: { schemas: Record<string, OpenApiSchema> }
}
const schemas = spec.components.schemas

type Keys<T> = Record<keyof T, true>

const SHAPES: Record<string, Record<string, true>> = {
  InstanceOut: {
    id: true,
    name: true,
    description: true,
    endpoint_path: true,
    endpoint_url: true,
    port: true,
    namespace_uri: true,
    security_policies: true,
    is_anonymous_allowed: true,
    is_autostart: true,
    desired_state: true,
    is_running: true,
    has_pending_restart: true,
    pending_fields: true,
    certificate: true,
    node_count: true,
    session_count: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<OpcuaInstance>,

  CertificateOut: {
    fingerprint: true,
    subject: true,
    expires_at: true,
  } satisfies Keys<OpcuaCertificate>,

  InstanceActionOut: {
    id: true,
    endpoint_url: true,
    desired_state: true,
    is_running: true,
  } satisfies Keys<OpcuaInstanceAction>,

  PortPoolOut: {
    total: true,
    used: true,
    available: true,
    instance_count: true,
    max_instances: true,
  } satisfies Keys<OpcuaPortPool>,

  NodeOut: {
    id: true,
    instance_id: true,
    parent_id: true,
    node_class: true,
    identifier: true,
    identifier_kind: true,
    node_id: true,
    browse_name: true,
    data_type: true,
    value_rank: true,
    array_dimensions: true,
    access_level: true,
    initial_value: true,
    description: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<OpcuaNode>,

  NodeMutationOut: {
    node: true,
    pending_fields: true,
  } satisfies Keys<OpcuaNodeMutation>,

  NodeValueOut: {
    node_id: true,
    identifier: true,
    data_type: true,
    value: true,
    is_live: true,
  } satisfies Keys<OpcuaNodeValue>,

  NodeWriteOut: {
    node_id: true,
    identifier: true,
    value: true,
  } satisfies Keys<OpcuaNodeWrite>,

  SessionOut: {
    session_id: true,
    peer: true,
    username: true,
    connected_at: true,
  } satisfies Keys<OpcuaSession>,

  CredentialOut: {
    id: true,
    instance_id: true,
    username: true,
    created_at: true,
  } satisfies Keys<OpcuaCredential>,

  CredentialCreatedOut: {
    credential: true,
    password: true,
  } satisfies Keys<OpcuaCredentialCreated>,

  TrustedCertificateOut: {
    id: true,
    instance_id: true,
    fingerprint: true,
    subject: true,
    expires_at: true,
    created_at: true,
  } satisfies Keys<OpcuaTrustedCertificate>,

  Page_InstanceOut_: {
    items: true,
    page: true,
    size: true,
    total: true,
  } satisfies Keys<Page<OpcuaInstance>>,
}

describe('@dt/contracts 的 opcua 类型与 openapi.json 的字段一致', () => {
  it.each(Object.keys(SHAPES))('%s', (schemaName) => {
    const schema = schemas[schemaName]
    expect(schema, `openapi.json 里没有 ${schemaName}`).toBeDefined()
    const actual = Object.keys(schema?.properties ?? {}).sort()
    const declared = Object.keys(SHAPES[schemaName] ?? {}).sort()
    expect(actual).toEqual(declared)
  })
})

/** 从 openapi 里取一个字段的枚举取值集合。 */
function enumOf(schemaName: string, field: string): string[] {
  const property = schemas[schemaName]?.properties?.[field]
  const found: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const shape: Record<string, unknown> = { ...node }
    if (Array.isArray(shape.enum)) {
      for (const value of shape.enum) {
        if (typeof value === 'string') found.push(value)
      }
    }
    for (const value of Object.values(shape)) {
      if (Array.isArray(value)) value.forEach(walk)
      else walk(value)
    }
  }
  walk(property)
  return [...new Set(found)].sort()
}

describe('const 联合与后端枚举一致', () => {
  it('数据类型', () => {
    expect([...OPCUA_DATA_TYPES].sort()).toEqual(
      enumOf('NodeCreateIn', 'data_type'),
    )
  })

  it('节点类别', () => {
    expect([...OPCUA_NODE_CLASSES].sort()).toEqual(
      enumOf('NodeCreateIn', 'node_class'),
    )
  })

  it('标识种类', () => {
    expect([...OPCUA_IDENTIFIER_KINDS].sort()).toEqual(
      enumOf('NodeCreateIn', 'identifier_kind'),
    )
  })

  it('安全策略', () => {
    expect([...OPCUA_SECURITY_POLICIES].sort()).toEqual(
      enumOf('InstanceCreateIn', 'security_policies'),
    )
  })

  it('期望状态只有两档', () => {
    expect([...OPCUA_DESIRED_STATES].sort()).toEqual(['running', 'stopped'])
  })
})

describe('契约里没有的东西不许在前端假装有', () => {
  it('会话不带令牌类型——想展示得先扩后端', () => {
    const keys = Object.keys(schemas.SessionOut?.properties ?? {})
    expect(keys).not.toContain('token_type')
    expect(keys).not.toContain('identity_token')
  })

  it('凭据的读面不含口令散列，明文只在创建回执里', () => {
    expect(Object.keys(schemas.CredentialOut?.properties ?? {})).not.toContain(
      'password',
    )
    expect(
      Object.keys(schemas.CredentialCreatedOut?.properties ?? {}),
    ).toContain('password')
  })

  it('信任证书不含私钥——私钥只在挂载卷上', () => {
    const keys = Object.keys(schemas.TrustedCertificateOut?.properties ?? {})
    expect(keys.join(',')).not.toContain('private')
  })
})

/**
 * 契约里的全部业务操作，形如 `POST /instances/{instance_id}:start`。
 * 探针不算业务面。
 */
function contractOperations(): string[] {
  const found: string[] = []
  for (const [path, ops] of Object.entries(spec.paths)) {
    if (path.endsWith('/health') || path.endsWith('/ready')) continue
    const relative = path.replace('/api/v1/opcua', '')
    for (const method of Object.keys(ops)) {
      found.push(`${method.toUpperCase()} ${relative}`)
    }
  }
  return found.sort()
}

describe('前端封装覆盖了契约里的每一个操作', () => {
  it('调用每个封装产出的方法与路径，与 openapi 的操作集完全相同', async () => {
    const client = await import('@/api/client')
    const api = await import('@/api/opcua')
    const seen: string[] = []
    // 签名必须与真 client 一致，否则打的桩与被替换的函数形状不同
    const record = <T>(path: string, options?: RequestOptions): Promise<T> => {
      seen.push(`${options?.method ?? 'GET'} ${path}`)
      return Promise.resolve({ items: [], page: 1, size: 20, total: 0 } as T)
    }
    vi.spyOn(client, 'request').mockImplementation(record)
    vi.spyOn(client, 'requestData').mockImplementation(record)

    // 占位符直接用 openapi 的参数名，产出的路径即路径模板本身
    const instance = '{instance_id}'
    const node = '{node_id}'
    await api.listInstances()
    await api.createInstance({
      name: 'a',
      namespace_uri: 'u',
      security_policies: ['NoSecurity'],
    })
    await api.getPortPool()
    await api.getInstance(instance)
    await api.updateInstance(instance, {})
    await api.deleteInstance(instance)
    await api.actOnInstance(instance, 'start')
    await api.actOnInstance(instance, 'stop')
    await api.actOnInstance(instance, 'restart')
    await api.listNodes(instance)
    await api.createNode(instance, { identifier: 'i', browse_name: 'b' })
    await api.getNode(instance, node)
    await api.updateNode(instance, node, {})
    await api.deleteNode(instance, node)
    await api.readNodeValue(instance, node)
    await api.writeNodeValue(instance, node, 1)
    await api.listSessions(instance)
    await api.listCredentials(instance)
    await api.createCredential(instance, { username: 'u' })
    await api.deleteCredential(instance, '{credential_id}')
    await api.listTrustedCertificates(instance)
    await api.addTrustedCertificate(instance, 'pem')
    await api.deleteTrustedCertificate(instance, '{certificate_id}')

    expect([...new Set(seen)].sort()).toEqual(contractOperations())
    vi.restoreAllMocks()
  })
})
