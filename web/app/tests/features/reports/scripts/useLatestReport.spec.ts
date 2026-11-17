/** @fileoverview 报告刷新、快速切换和卸载清理。 */
import type { ReportRender } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { useLatestReport } from '@/features/reports/scripts/useLatestReport'
import type { LatestReport } from '@/features/reports/scripts/latestReport'

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  detail: vi.fn(),
  bytes: vi.fn(),
}))
vi.mock('@/features/reports/scripts/latestReport', () => ({
  findLatestReport: mocks.find,
}))
vi.mock('@/api/reports', () => ({
  getReportRender: mocks.detail,
  downloadReport: mocks.bytes,
}))

function record(id: string): ReportRender {
  return {
    id,
    template_id: 'template',
    schedule_id: null,
    period: '2023-12',
    granularity: 'month',
    timezone: 'Asia/Shanghai',
    kind: 'render',
    status: 'succeeded',
    warnings: [],
    error: null,
    created_at: '2026-11-17T00:00:00Z',
    started_at: null,
    finished_at: null,
  }
}
const Harness = defineComponent({
  props: {
    code: { type: String, default: '' },
    seconds: { type: Number, default: 0 },
    allowed: { type: Boolean, default: true },
  },
  setup: (props) =>
    useLatestReport(
      () => props.code,
      () => props.seconds,
      () => props.allowed,
    ),
  template: '<p>{{ document?.record.id }} {{ error }}</p>',
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.detail.mockResolvedValue({ warnings: [], preview: null })
  mocks.bytes.mockResolvedValue(new Blob(['Word']))
})
afterEach(() => vi.useRealTimers())
describe('报告刷新', () => {
  it('旧模板慢响应不能覆盖新模板报告', async () => {
    let resolveOld: ((value: LatestReport) => void) | undefined
    mocks.find
      .mockImplementationOnce(
        () =>
          new Promise<LatestReport>((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce({ name: '新报告', record: record('new') })
    const wrapper = mount(Harness, { props: { code: 'old' } })
    await wrapper.setProps({ code: 'new' })
    await flushPromises()
    resolveOld?.({ name: '旧报告', record: record('old') })
    await flushPromises()
    expect(wrapper.text()).toContain('new')
    expect(wrapper.text()).not.toContain('old')
    expect(mocks.bytes).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('刷新相同成功记录不重复下载，卸载清理轮询', async () => {
    vi.useFakeTimers()
    const clear = vi.spyOn(globalThis, 'clearInterval')
    mocks.find.mockResolvedValue({ name: '报告', record: record('same') })
    const wrapper = mount(Harness, { props: { seconds: 1 } })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10000)
    expect(mocks.find).toHaveBeenCalledTimes(2)
    expect(mocks.bytes).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
  it('没有权限不读取报告，加载失败有错误信息', async () => {
    const wrapper = mount(Harness, { props: { allowed: false } })
    await flushPromises()
    expect(mocks.find).not.toHaveBeenCalled()
    mocks.find.mockRejectedValue(new Error('连接不可用'))
    await wrapper.setProps({ allowed: true })
    await flushPromises()
    expect(wrapper.text()).toContain('请求失败')
    wrapper.unmount()
  })
})
