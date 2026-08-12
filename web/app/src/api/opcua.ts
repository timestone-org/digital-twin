/**
 * @fileoverview OPC UA 服务端管理面的接口封装。组件不直接发请求，一律经这里。
 *
 * ⚠ 创建实例、创建节点、写节点值三处必须带 `Idempotency-Key`：网络抖动导致的
 * 重试在没有幂等键时会**建两个实例**或**向上位机暴露的节点写两次**。
 */

import type {
  OpcuaCredential,
  OpcuaCredentialCreated,
  OpcuaInstance,
  OpcuaInstanceAction,
  OpcuaInstanceCreateInput,
  OpcuaInstanceUpdateInput,
  OpcuaNode,
  OpcuaNodeCreateInput,
  OpcuaNodeMutation,
  OpcuaNodeUpdateInput,
  OpcuaNodeValue,
  OpcuaNodeWrite,
  OpcuaPortPool,
  OpcuaSession,
  OpcuaTrustedCertificate,
  Page,
} from '@dt/contracts'

import { OPCUA_BASE_URL } from '@/config/app'
import { request, requestData } from './client'

export type OpcuaPageQuery = {
  q?: string | undefined
  page?: number | undefined
  size?: number | undefined
}

/**
 * 生成一个幂等键。
 *
 * ⚠ 不用 `crypto.randomUUID()`：它只在**安全上下文**（HTTPS 或 localhost）里存在。
 * 本平台按内网 IP 走纯 HTTP 交付，那里 `crypto.randomUUID` 是 undefined，
 * 调用直接抛 TypeError——而它只在现场炸，开发机（localhost）永远复现不了。
 */
export function newIdempotencyKey(): string {
  const random = Math.random().toString(36).slice(2)
  const more = Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}-${random}${more}`
}

function opcua<T>(
  path: string,
  options: Parameters<typeof requestData>[1] = {},
): Promise<T> {
  return requestData<T>(path, { ...options, baseUrl: OPCUA_BASE_URL })
}

function idempotent(key: string): Record<'Idempotency-Key', string> {
  return { 'Idempotency-Key': key }
}

/* ---------------- 实例 ---------------- */

export async function listInstances(
  query: OpcuaPageQuery = {},
): Promise<Page<OpcuaInstance>> {
  return await opcua<Page<OpcuaInstance>>('/instances', { query })
}

export async function getInstance(instanceId: string): Promise<OpcuaInstance> {
  return await opcua<OpcuaInstance>(`/instances/${instanceId}`)
}

export async function getPortPool(): Promise<OpcuaPortPool> {
  return await opcua<OpcuaPortPool>('/instances/port-pool')
}

export async function createInstance(
  input: OpcuaInstanceCreateInput,
  key: string = newIdempotencyKey(),
): Promise<OpcuaInstance> {
  return await opcua<OpcuaInstance>('/instances', {
    method: 'POST',
    body: input,
    headers: idempotent(key),
  })
}

export async function updateInstance(
  instanceId: string,
  input: OpcuaInstanceUpdateInput,
): Promise<OpcuaInstance> {
  return await opcua<OpcuaInstance>(`/instances/${instanceId}`, {
    method: 'PUT',
    body: input,
  })
}

export async function deleteInstance(instanceId: string): Promise<void> {
  await request(`/instances/${instanceId}`, {
    method: 'DELETE',
    baseUrl: OPCUA_BASE_URL,
  })
}

/** 起停与重启。⚠ 停与重启都会断开该实例上全部上位机会话。 */
export async function actOnInstance(
  instanceId: string,
  verb: 'start' | 'stop' | 'restart',
): Promise<OpcuaInstanceAction> {
  return await opcua<OpcuaInstanceAction>(`/instances/${instanceId}:${verb}`, {
    method: 'POST',
  })
}

/* ---------------- 地址空间 ---------------- */

export async function listNodes(
  instanceId: string,
  query: OpcuaPageQuery = {},
): Promise<Page<OpcuaNode>> {
  return await opcua<Page<OpcuaNode>>(`/instances/${instanceId}/nodes`, {
    query,
  })
}

export async function getNode(
  instanceId: string,
  nodeId: string,
): Promise<OpcuaNode> {
  return await opcua<OpcuaNode>(`/instances/${instanceId}/nodes/${nodeId}`)
}

export async function createNode(
  instanceId: string,
  input: OpcuaNodeCreateInput,
  key: string = newIdempotencyKey(),
): Promise<OpcuaNodeMutation> {
  return await opcua<OpcuaNodeMutation>(`/instances/${instanceId}/nodes`, {
    method: 'POST',
    body: input,
    headers: idempotent(key),
  })
}

export async function updateNode(
  instanceId: string,
  nodeId: string,
  input: OpcuaNodeUpdateInput,
): Promise<OpcuaNodeMutation> {
  return await opcua<OpcuaNodeMutation>(
    `/instances/${instanceId}/nodes/${nodeId}`,
    { method: 'PUT', body: input },
  )
}

export async function deleteNode(
  instanceId: string,
  nodeId: string,
): Promise<void> {
  await request(`/instances/${instanceId}/nodes/${nodeId}`, {
    method: 'DELETE',
    baseUrl: OPCUA_BASE_URL,
  })
}

export async function readNodeValue(
  instanceId: string,
  nodeId: string,
): Promise<OpcuaNodeValue> {
  return await opcua<OpcuaNodeValue>(
    `/instances/${instanceId}/nodes/${nodeId}/value`,
  )
}

/** ⚠ 写值改变的是上位系统读到的现场数据，不是一个本地草稿。 */
export async function writeNodeValue(
  instanceId: string,
  nodeId: string,
  value: unknown,
  key: string = newIdempotencyKey(),
): Promise<OpcuaNodeWrite> {
  return await opcua<OpcuaNodeWrite>(
    `/instances/${instanceId}/nodes/${nodeId}:write`,
    { method: 'POST', body: { value }, headers: idempotent(key) },
  )
}

/* ---------------- 会话与凭据 ---------------- */

export async function listSessions(
  instanceId: string,
): Promise<OpcuaSession[]> {
  return await opcua<OpcuaSession[]>(`/instances/${instanceId}/sessions`)
}

export async function listCredentials(
  instanceId: string,
): Promise<OpcuaCredential[]> {
  return await opcua<OpcuaCredential[]>(`/instances/${instanceId}/credentials`)
}

/** ⚠ 回执里的明文口令只此一次，之后任何接口都取不到。 */
export async function createCredential(
  instanceId: string,
  input: { username: string; password?: string | null },
): Promise<OpcuaCredentialCreated> {
  return await opcua<OpcuaCredentialCreated>(
    `/instances/${instanceId}/credentials`,
    { method: 'POST', body: input },
  )
}

export async function deleteCredential(
  instanceId: string,
  credentialId: string,
): Promise<void> {
  await request(`/instances/${instanceId}/credentials/${credentialId}`, {
    method: 'DELETE',
    baseUrl: OPCUA_BASE_URL,
  })
}

export async function listTrustedCertificates(
  instanceId: string,
): Promise<OpcuaTrustedCertificate[]> {
  return await opcua<OpcuaTrustedCertificate[]>(
    `/instances/${instanceId}/trusted-certificates`,
  )
}

export async function addTrustedCertificate(
  instanceId: string,
  certificatePem: string,
): Promise<OpcuaTrustedCertificate> {
  return await opcua<OpcuaTrustedCertificate>(
    `/instances/${instanceId}/trusted-certificates`,
    { method: 'POST', body: { certificate_pem: certificatePem } },
  )
}

export async function deleteTrustedCertificate(
  instanceId: string,
  certificateId: string,
): Promise<void> {
  await request(
    `/instances/${instanceId}/trusted-certificates/${certificateId}`,
    { method: 'DELETE', baseUrl: OPCUA_BASE_URL },
  )
}
