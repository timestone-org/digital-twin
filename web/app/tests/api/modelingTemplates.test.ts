/** @fileoverview 模板建模 SDK 的公共端点、分页和幂等请求契约。 */
import { beforeEach, expect, it, vi } from 'vitest'
import * as api from '@/api/modelingTemplates'
import { requestData } from '@/api/client'

vi.mock('@/api/client', () => ({ requestData: vi.fn().mockResolvedValue({}) }))
beforeEach(() => vi.clearAllMocks())

it('内置目录在服务端执行分类、关键词和分页，空白检索不发送', async () => {
  const signal = new AbortController().signal
  await api.listBuiltinTemplates(
    { page: 3, size: 20, q: '  回归_%  ', category: 'prediction' },
    signal,
  )
  expect(requestData).toHaveBeenLastCalledWith('/modeling-builtin-templates', {
    baseUrl: '/api/v1/platform',
    signal,
    query: { page: 3, size: 20, q: '回归_%', category: 'prediction' },
  })
  await api.listBuiltinTemplates({
    page: 1,
    size: 20,
    q: '  ',
    category: 'all',
  })
  expect(requestData).toHaveBeenLastCalledWith('/modeling-builtin-templates', {
    baseUrl: '/api/v1/platform',
    query: { page: 1, size: 20, category: 'all' },
  })
})

it('读模板、模型和完整配置时使用平台前缀与有界分页', async () => {
  const controller = new AbortController()
  await api.listTemplates({ page: 2, size: 20, q: '能耗' }, controller.signal)
  expect(requestData).toHaveBeenLastCalledWith('/modeling-templates', {
    baseUrl: '/api/v1/platform',
    signal: controller.signal,
    query: { page: 2, size: 20, q: '能耗' },
  })
  await api.listInstances({ page: 1, size: 20 })
  expect(requestData).toHaveBeenLastCalledWith('/modeling-instances', {
    baseUrl: '/api/v1/platform',
    query: { page: 1, size: 20 },
  })
  await api.getTemplateConfiguration('template-1')
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-templates/template-1/configuration',
    { baseUrl: '/api/v1/platform' },
  )
  await api.getInstance('model-1')
  expect(requestData).toHaveBeenLastCalledWith('/modeling-instances/model-1', {
    baseUrl: '/api/v1/platform',
  })
  await api.getInstanceConfiguration('model-1')
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-instances/model-1/configuration',
    { baseUrl: '/api/v1/platform' },
  )
})

it('创建、整体配置、训练和部署每次携带独立幂等键', async () => {
  await api.publishTemplate({ pipeline_id: 'design-1', name: '模板' })
  await api.setTemplateEnabled('template-1', false)
  await api.createInstance({
    template_id: 'template-1',
    name: '模型',
    code: 'energy',
  })
  await api.configureInstance('model-1', {
    expected_revision: 2,
    configuration: { nodes: {} },
  })
  await api.trainInstance('model-1')
  await api.deployInstance('model-1', {
    model_version_id: 'version-1',
    code: 'energy-serving',
    name: '服务',
  })
  const calls = vi.mocked(requestData).mock.calls
  expect(calls.map(([path, options]) => [path, options?.method])).toEqual([
    ['/modeling-templates', 'POST'],
    ['/modeling-templates/template-1', 'PATCH'],
    ['/modeling-instances', 'POST'],
    ['/modeling-instances/model-1/configuration', 'PUT'],
    ['/modeling-instances/model-1:train', 'POST'],
    ['/modeling-instances/model-1:deploy', 'POST'],
  ])
  const keys = calls.map(([, options]) =>
    new Headers(options?.headers).get('Idempotency-Key'),
  )
  expect(keys.every((key) => typeof key === 'string' && key.length > 0)).toBe(
    true,
  )
  expect(new Set(keys).size).toBe(6)
  expect(calls[3]?.[1]?.body).toEqual({
    expected_revision: 2,
    configuration: { nodes: {} },
  })
})

it('读取历史训练配置时带运行 ID，保持只读请求与取消信号', async () => {
  const signal = new AbortController().signal
  await api.getInstanceConfiguration('model-1', signal, 'run-1')
  expect(requestData).toHaveBeenLastCalledWith(
    '/modeling-instances/model-1/configuration',
    { baseUrl: '/api/v1/platform', signal, query: { run_id: 'run-1' } },
  )
})

it('实例归档筛选和归档恢复使用真实修订号与独立幂等键', async () => {
  await api.listInstances({ page: 1, size: 20, archived: 'archived' })
  expect(requestData).toHaveBeenLastCalledWith('/modeling-instances', {
    baseUrl: '/api/v1/platform',
    query: { page: 1, size: 20, archived: 'archived' },
  })
  await api.archiveInstance('instance-1', 3)
  await api.restoreInstance('instance-2', 7)
  const writes = vi.mocked(requestData).mock.calls.slice(-2)
  expect(
    writes.map(([path, options]) => [path, options?.method, options?.body]),
  ).toEqual([
    [
      '/modeling-instances/instance-1:archive',
      'POST',
      { expected_revision: 3 },
    ],
    [
      '/modeling-instances/instance-2:restore',
      'POST',
      { expected_revision: 7 },
    ],
  ])
  const keys = writes.map(([, options]) =>
    new Headers(options?.headers).get('Idempotency-Key'),
  )
  expect(keys.every(Boolean)).toBe(true)
  expect(new Set(keys).size).toBe(2)
})
