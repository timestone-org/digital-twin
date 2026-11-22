/** @fileoverview 固定知识库重嵌的请求前缀、有界进度读取与幂等确认。 */
import { afterEach, expect, it, vi } from 'vitest'
import * as client from '@/api/client'
import * as api from '@/api/knowledgeReembedding'

const job = {
  id: 'job/1',
  base_id: 'base/1',
  status: 'running',
  completed_chunks: 1,
  total_chunks: 4,
}
const SPACE = 'b'.repeat(64)
const path = '/knowledge-bases/base%2F1/reembeddings'
afterEach(() => vi.restoreAllMocks())

it('预检的目标可被确认，启动只发送空间和修订号并复用给定键', async () => {
  const signal = new AbortController().signal
  const preview = {
    can_start: true,
    target_model: 'model-b',
    target_dimensions: 4,
    target_space_id: SPACE,
    content_revision: 7,
    total_chunks: 4,
    total_documents: 1,
  }
  const request = vi
    .spyOn(client, 'requestData')
    .mockResolvedValueOnce(preview)
    .mockResolvedValueOnce(job)
  expect(await api.previewReembedding('base/1', signal)).toEqual(preview)
  const body = { target_space_id: SPACE, expected_revision: 7 }
  await api.startReembedding('base/1', body, 'same-operation')
  expect(request.mock.calls).toEqual([
    [
      path + ':preview',
      { baseUrl: '/api/v1/knowledge', method: 'POST', body: {}, signal },
    ],
    [
      path,
      {
        baseUrl: '/api/v1/knowledge',
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': 'same-operation' },
      },
    ],
  ])
})

it('只读最新一项，进度和取消使用同一库内经过编码的任务 ID', async () => {
  const signal = new AbortController().signal
  const request = vi
    .spyOn(client, 'requestData')
    .mockResolvedValueOnce({ items: [job], total: 1 })
    .mockResolvedValueOnce(job)
    .mockResolvedValueOnce(job)
  expect(await api.latestReembedding('base/1', signal)).toEqual(job)
  expect(await api.readReembedding('base/1', 'job/1', signal)).toEqual(job)
  expect(await api.cancelReembedding('base/1', 'job/1')).toEqual(job)
  expect(request.mock.calls).toEqual([
    [
      path,
      { baseUrl: '/api/v1/knowledge', query: { page: 1, size: 1 }, signal },
    ],
    [path + '/job%2F1', { baseUrl: '/api/v1/knowledge', signal }],
    [
      path + '/job%2F1:cancel',
      { baseUrl: '/api/v1/knowledge', method: 'POST' },
    ],
  ])
})

it('空列表、缺失的工作量和错库任务有不同结果', async () => {
  const signal = new AbortController().signal
  vi.spyOn(client, 'requestData')
    .mockResolvedValueOnce({ items: [], total: 0 })
    .mockResolvedValueOnce({ items: [], total: 2 })
    .mockResolvedValueOnce({ ...job, base_id: 'other' })
    .mockResolvedValueOnce({ can_start: true, target_space_id: null })
  await expect(api.latestReembedding('base/1', signal)).resolves.toBeNull()
  await expect(api.latestReembedding('base/1', signal)).rejects.toThrow(
    '不完整',
  )
  await expect(api.readReembedding('base/1', 'job/1', signal)).rejects.toThrow(
    '当前知识库',
  )
  await expect(api.previewReembedding('base/1', signal)).rejects.toThrow('预检')
})
