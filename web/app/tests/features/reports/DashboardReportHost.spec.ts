/** @fileoverview 最新报告的权限、正文、图表与下载。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Component from '@/features/reports/DashboardReportHost.vue'
const find = vi.hoisted(() => vi.fn())
const controls = vi.hoisted(() => ({
  public: true,
  permitted: true,
  detail: vi.fn(),
  bytes: vi.fn(),
  download: vi.fn(),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: { public: controls.public } }),
}))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ can: () => controls.permitted }),
}))
vi.mock('@/features/reports/scripts/latestReport', () => ({
  findLatestReport: find,
}))
vi.mock('@/api/reports', () => ({
  getReportRender: controls.detail,
  downloadReport: controls.bytes,
}))
vi.mock('@/utils/downloadJson', () => ({
  downloadBytes: controls.download,
  toFileName: (value: string) => value,
}))
beforeEach(() => {
  controls.public = true
  controls.permitted = true
  controls.detail.mockResolvedValue({
    warnings: ['历史数据提示'],
    preview: {
      nodes: {
        chart: {
          kind: 'line',
          title: '综合指数',
          x_axis: 'category',
          categories: ['2023-12'],
          series: [{ name: '综合指数', points: [], values: ['1'] }],
        },
      },
    },
  })
  controls.bytes.mockResolvedValue(new Blob(['docx']))
})
afterEach(() => vi.clearAllMocks())

it('即使同源已登录，公开大屏也不请求私有报告', async () => {
  const wrapper = mount(Component, {
    props: { templateCode: 'green', refreshSeconds: 30 },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('公开大屏不展示私有报告')
  expect(find).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('最新成功报告显示原件、生成图表、警告和下载', async () => {
  controls.public = false
  find.mockResolvedValue({
    name: '绿色生产月报',
    record: {
      id: 'latest',
      period: '2023-12',
      created_at: '2026-11-17T00:00:00Z',
      finished_at: null,
    },
  })
  const wrapper = mount(Component, {
    props: { templateCode: 'green', refreshSeconds: 0 },
    global: {
      stubs: {
        DocxPreview: { template: '<p>Word 原件与原位图表</p>' },
      },
    },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('绿色生产月报')
  expect(wrapper.text()).toContain('2023-12')
  expect(wrapper.find('section[aria-label="生成时图表"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('Word 原件与原位图表')
  expect(wrapper.text()).toContain('报告提示（1）')
  expect(wrapper.get('details').attributes('open')).toBeUndefined()
  const download = wrapper
    .findAll('button')
    .find((button) => button.text().includes('下载 Word'))
  if (!download) throw new Error('下载按钮未显示')
  await download.trigger('click')
  expect(controls.download).toHaveBeenCalledWith(
    expect.any(Blob),
    '绿色生产月报-2023-12.docx',
  )
  find.mockRejectedValueOnce(new Error('unavailable'))
  const refresh = wrapper
    .findAll('button')
    .find((button) => button.text().includes('刷新'))
  if (!refresh) throw new Error('刷新按钮未显示')
  await refresh.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('保留上次成功读取的报告')
  wrapper.unmount()
})

it('没有成功记录显示空态，没有原件权限时不请求报告', async () => {
  controls.public = false
  find.mockResolvedValue(null)
  const wrapper = mount(Component, {
    props: { templateCode: '', refreshSeconds: 0 },
  })
  await flushPromises()
  expect(wrapper.text()).toContain('暂无成功生成的报告')
  wrapper.unmount()
  controls.permitted = false
  find.mockClear()
  const denied = mount(Component, {
    props: { templateCode: 'green', refreshSeconds: 0 },
  })
  await flushPromises()
  expect(find).not.toHaveBeenCalled()
  expect(denied.text()).toContain('原件读取权限')
  denied.unmount()
})
