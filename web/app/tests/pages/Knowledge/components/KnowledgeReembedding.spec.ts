/** @fileoverview 通过真实管理界面核对预检、确认、同键重试和任务终态。 */
import type {
  KnowledgeReembeddingJob,
  KnowledgeReembeddingPreview,
} from '@dt/contracts'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BizError, TransportError } from '@/api/client'
import type { KnowledgeBase } from '@/api/knowledge'
import * as api from '@/api/knowledgeReembedding'
import Panel from '@/pages/Knowledge/components/KnowledgeReembedding.vue'

vi.mock('@/api/knowledgeReembedding')
const SPACE = 'b'.repeat(64)
const NEXT_SPACE = 'c'.repeat(64)
const base: KnowledgeBase = {
  id: 'a',
  name: '资料甲',
  description: '',
  strategy: 'hybrid',
  embeddingModel: '模型甲',
  dimensions: 4,
  vectorStatus: 'space_mismatch',
  documentCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
}
const preview: KnowledgeReembeddingPreview = {
  target_model: '模型乙',
  target_dimensions: 4,
  target_space_id: SPACE,
  content_revision: 8,
  total_documents: 2,
  total_chunks: 6,
  can_start: true,
  note: '',
}
const job: KnowledgeReembeddingJob = {
  id: 'j1',
  base_id: 'a',
  status: 'pending',
  target_model: '模型乙',
  target_dimensions: 4,
  total_chunks: 6,
  completed_chunks: 0,
  created_at: base.createdAt,
  finished_at: null,
  error_message: null,
}
const mountPanel = () =>
  mount(Panel, { props: { base }, global: { stubs: { teleport: true } } })
type Wrapper = ReturnType<typeof mountPanel>
async function click(wrapper: Wrapper, label: string) {
  const button = wrapper
    .findAll('button')
    .find((one) => one.text().trim() === label)
  if (!button) throw new Error(`找不到按钮 ${label}`)
  await button.trigger('click')
  await flushPromises()
}
async function render() {
  const wrapper = mountPanel()
  await flushPromises()
  return wrapper
}
enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.latestReembedding).mockResolvedValue(null)
  vi.mocked(api.previewReembedding).mockResolvedValue(preview)
  vi.mocked(api.startReembedding).mockResolvedValue(job)
})
afterEach(() => vi.useRealTimers())

it('展示旧目标模型及工作量，返回不会启动；确认才按预检修订启动', async () => {
  const wrapper = await render()
  await click(wrapper, '整库重嵌')
  const modal = wrapper.get('[role="dialog"]')
  for (const value of [
    '模型甲',
    '模型乙',
    '4 维',
    SPACE,
    '2 份文档',
    '6 个数据块',
    '内容修订号',
    '8',
  ])
    expect(modal.text()).toContain(value)
  expect(api.startReembedding).not.toHaveBeenCalled()
  await click(wrapper, '返回')
  expect(api.startReembedding).not.toHaveBeenCalled()
  await click(wrapper, '整库重嵌')
  await click(wrapper, '确认重嵌')
  expect(api.startReembedding).toHaveBeenCalledExactlyOnceWith(
    'a',
    { target_space_id: SPACE, expected_revision: 8 },
    expect.any(String),
  )
  expect(wrapper.text()).toContain('等待重嵌')
  expect(wrapper.emitted('published')).toBeUndefined()
})

it('预检过期后重读工作量与空间，管理员须再次确认', async () => {
  vi.mocked(api.previewReembedding)
    .mockResolvedValueOnce(preview)
    .mockResolvedValueOnce({
      ...preview,
      content_revision: 9,
      target_space_id: NEXT_SPACE,
      target_model: '模型丙',
      total_chunks: 10,
    })
  vi.mocked(api.startReembedding).mockRejectedValueOnce(
    new BizError(42330, '预检已过期', 409, 'qa'),
  )
  const wrapper = await render()
  await click(wrapper, '整库重嵌')
  await click(wrapper, '确认重嵌')
  expect(wrapper.get('[role="dialog"]').text()).toContain('模型丙')
  expect(wrapper.get('[role="dialog"]').text()).toContain('10 个数据块')
  expect(api.startReembedding).toHaveBeenCalledTimes(1)
  await click(wrapper, '确认重嵌')
  const calls = vi.mocked(api.startReembedding).mock.calls
  expect(calls[1]?.[1]).toEqual({
    expected_revision: 9,
    target_space_id: NEXT_SPACE,
  })
  expect(calls[1]?.[2]).not.toBe(calls[0]?.[2])
})

it('未确认的提交由管理员显式重试，同一目标和修订沿用原幂等键', async () => {
  vi.mocked(api.startReembedding).mockRejectedValueOnce(
    new TransportError(0, '连接中断'),
  )
  const wrapper = await render()
  await click(wrapper, '整库重嵌')
  await click(wrapper, '确认重嵌')
  expect(wrapper.text()).toContain('连接中断')
  expect(api.startReembedding).toHaveBeenCalledTimes(1)
  await click(wrapper, '返回')
  await click(wrapper, '整库重嵌')
  await click(wrapper, '确认重嵌')
  const [first, second] = vi.mocked(api.startReembedding).mock.calls
  expect(first?.[2]).toBeTruthy()
  expect(second).toEqual(first)
})

it('在处理中的任务可观察进度，只有服务端报告成功才刷新已发布索引', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.mocked(api.latestReembedding).mockResolvedValue({
    ...job,
    status: 'running',
    completed_chunks: 2,
  })
  vi.mocked(api.readReembedding)
    .mockResolvedValueOnce({ ...job, status: 'running', completed_chunks: 5 })
    .mockResolvedValueOnce({ ...job, status: 'succeeded', completed_chunks: 6 })
  const wrapper = await render()
  expect(wrapper.text()).toContain('2 / 6 块')
  await vi.advanceTimersByTimeAsync(3000)
  await flushPromises()
  expect(wrapper.text()).toContain('5 / 6 块')
  expect(wrapper.emitted('published')).toBeUndefined()
  await vi.advanceTimersByTimeAsync(3000)
  await flushPromises()
  expect(wrapper.text()).toContain('重嵌已完成')
  expect(wrapper.emitted('published')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(12000)
  expect(api.readReembedding).toHaveBeenCalledTimes(2)
})

it('取消需要确认；收到取消或失败时显示原因并保留已发布版本', async () => {
  vi.mocked(api.latestReembedding).mockResolvedValue(job)
  vi.mocked(api.cancelReembedding).mockResolvedValue({
    ...job,
    status: 'cancelled',
  })
  const wrapper = await render()
  await click(wrapper, '取消重嵌')
  await click(wrapper, '返回')
  expect(api.cancelReembedding).not.toHaveBeenCalled()
  await click(wrapper, '取消重嵌')
  await click(wrapper, '确认取消')
  expect(api.cancelReembedding).toHaveBeenCalledExactlyOnceWith('a', 'j1')
  expect(wrapper.text()).toContain('重嵌已取消')
  expect(wrapper.emitted('published')).toBeUndefined()
  vi.mocked(api.latestReembedding).mockResolvedValue({
    ...job,
    status: 'failed',
    error_message: '输入文档已变更',
  })
  await click(wrapper, '刷新任务')
  expect(wrapper.text()).toContain('输入文档已变更')
  expect(wrapper.emitted('published')).toBeUndefined()
})

it('目标不可用时显示服务端说明并保留预检入口', async () => {
  vi.mocked(api.previewReembedding).mockResolvedValue({
    ...preview,
    can_start: false,
    target_model: null,
    target_space_id: null,
    target_dimensions: null,
    note: '尚未配置嵌入模型',
  })
  const wrapper = await render()
  await click(wrapper, '整库重嵌')
  expect(wrapper.text()).toContain('尚未配置嵌入模型')
  await click(wrapper, '确认重嵌')
  expect(api.startReembedding).not.toHaveBeenCalled()
})

it('另一管理员已启动任务时读取后台现有任务，不重复创建', async () => {
  vi.mocked(api.latestReembedding)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ ...job, status: 'running', completed_chunks: 3 })
  vi.mocked(api.startReembedding).mockRejectedValueOnce(
    new BizError(42331, '已有任务', 409, 'qa'),
  )
  const wrapper = await render()
  await click(wrapper, '整库重嵌')
  await click(wrapper, '确认重嵌')
  expect(api.startReembedding).toHaveBeenCalledOnce()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('3 / 6 块')
})

it('读任务失败时保留上次进度，刷新后恢复', async () => {
  vi.mocked(api.latestReembedding).mockResolvedValue(job)
  vi.mocked(api.readReembedding)
    .mockRejectedValueOnce(new TransportError(0, '暂时断开'))
    .mockResolvedValueOnce({ ...job, status: 'running', completed_chunks: 2 })
  const wrapper = await render()
  await click(wrapper, '刷新任务')
  expect(wrapper.text()).toContain('重嵌任务状态未刷新')
  expect(wrapper.text()).toContain('0 / 6 块')
  await click(wrapper, '刷新任务')
  expect(wrapper.text()).not.toContain('暂时断开')
  expect(wrapper.text()).toContain('2 / 6 块')
})

it('切离知识库时中止任务读取和定时轮询', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.mocked(api.latestReembedding).mockResolvedValue(job)
  vi.mocked(api.readReembedding).mockImplementation(
    (_base, _job, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('离开知识库')))
      }),
  )
  const wrapper = await render()
  await vi.advanceTimersByTimeAsync(3000)
  const signal = vi.mocked(api.readReembedding).mock.calls[0]?.[2]
  wrapper.unmount()
  expect(signal?.aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(9000)
  expect(api.readReembedding).toHaveBeenCalledOnce()
})

it('取消成功后，先发出的轮询不能把任务改回进行中', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.mocked(api.latestReembedding).mockResolvedValue(job)
  let finish: (value: KnowledgeReembeddingJob) => void = () => undefined
  vi.mocked(api.readReembedding).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  vi.mocked(api.cancelReembedding).mockResolvedValue({
    ...job,
    status: 'cancelled',
  })
  const wrapper = await render()
  await vi.advanceTimersByTimeAsync(3000)
  await click(wrapper, '取消重嵌')
  await click(wrapper, '确认取消')
  finish({ ...job, status: 'running', completed_chunks: 2 })
  await flushPromises()
  expect(wrapper.text()).toContain('重嵌已取消')
  expect(wrapper.text()).not.toContain('正在重嵌')
})
