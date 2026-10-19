/** @fileoverview 层级图服务接口，统一信封、令牌和超时由 client 处理。 */
import type {
  HierarchyCapabilities,
  HierarchyDocument,
  HierarchyHistory,
  HierarchyPage,
  HierarchyProject,
} from '@dt/contracts'
import { HIERARCHY_BASE_URL } from '@/config/app'
import { request, requestData } from './client'
import { newIdempotencyKey } from './idempotency'

export function capabilities(
  signal?: AbortSignal,
): Promise<HierarchyCapabilities> {
  return requestData('/capabilities', {
    baseUrl: HIERARCHY_BASE_URL,
    signal,
    timeoutMs: 3000,
  })
}
export function listProjects(
  query: { page: number; size: number; q: string },
  signal?: AbortSignal,
): Promise<HierarchyPage> {
  return requestData('/projects', {
    baseUrl: HIERARCHY_BASE_URL,
    query,
    signal,
  })
}
export function getProject(
  id: string,
  signal?: AbortSignal,
): Promise<HierarchyProject> {
  return requestData(`/projects/${encodeURIComponent(id)}`, {
    baseUrl: HIERARCHY_BASE_URL,
    signal,
  })
}
export function createProject(
  document: HierarchyDocument,
  key = newIdempotencyKey(),
): Promise<HierarchyProject> {
  return requestData('/projects', {
    baseUrl: HIERARCHY_BASE_URL,
    method: 'POST',
    body: { document },
    headers: { 'Idempotency-Key': key },
  })
}
export function saveProject(
  id: string,
  revision: number,
  document: HierarchyDocument,
): Promise<HierarchyProject> {
  return requestData(`/projects/${encodeURIComponent(id)}`, {
    baseUrl: HIERARCHY_BASE_URL,
    method: 'PUT',
    body: { revision, document },
  })
}
export async function deleteProject(id: string): Promise<void> {
  await request(`/projects/${encodeURIComponent(id)}`, {
    baseUrl: HIERARCHY_BASE_URL,
    method: 'DELETE',
  })
}
export function history(
  id: string,
  signal?: AbortSignal,
): Promise<HierarchyHistory> {
  return requestData(`/projects/${encodeURIComponent(id)}/versions`, {
    baseUrl: HIERARCHY_BASE_URL,
    signal,
  })
}
export function restoreProject(
  id: string,
  revision: number,
  targetRevision: number,
): Promise<HierarchyProject> {
  return requestData(`/projects/${encodeURIComponent(id)}:restore`, {
    baseUrl: HIERARCHY_BASE_URL,
    method: 'POST',
    body: { revision, target_revision: targetRevision },
  })
}
