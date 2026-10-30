/** @fileoverview 报告图表跟随主题取色并在卸载后释放观察器。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import * as tokens from '@dt/tokens'
import ReportChart from '@/pages/Reports/Editor/components/ReportChart.vue'

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}))
const initialize = vi.hoisted(() => vi.fn(() => chart))
const detach = vi.hoisted(() => vi.fn())
vi.mock('echarts', () => ({ init: initialize }))
vi.mock('@dt/tokens', async (original) => ({
  ...(await original<typeof tokens>()),
  readToken: vi.fn((name: string) =>
    document.documentElement.style.getPropertyValue(name),
  ),
  observeThemeChange: vi.fn(() => detach),
}))

afterEach(() => {
  vi.clearAllMocks()
  document.documentElement.style.removeProperty('--text-secondary')
})

it('使用当前主题文本颜色且不固定为深色图表', async () => {
  document.documentElement.style.setProperty(
    '--text-secondary',
    'rgb(30, 40, 50)',
  )
  const wrapper = mount(ReportChart, {
    props: { node: { kind: 'line', title: '能耗', series: [] } },
    attachTo: document.body,
  })
  await flushPromises()
  expect(initialize.mock.calls[0]).toHaveLength(1)
  expect(chart.setOption).toHaveBeenCalledWith(
    expect.objectContaining({
      textStyle: { color: 'rgb(30, 40, 50)' },
    }),
  )
  const changed = vi.mocked(tokens.observeThemeChange).mock.calls[0]?.[1]
  document.documentElement.style.setProperty(
    '--text-secondary',
    'rgb(210, 220, 230)',
  )
  changed?.()
  await flushPromises()
  expect(chart.setOption).toHaveBeenLastCalledWith(
    expect.objectContaining({
      textStyle: { color: 'rgb(210, 220, 230)' },
    }),
    { notMerge: true },
  )
  wrapper.unmount()
  expect(detach).toHaveBeenCalledOnce()
  expect(chart.dispose).toHaveBeenCalledOnce()
})
