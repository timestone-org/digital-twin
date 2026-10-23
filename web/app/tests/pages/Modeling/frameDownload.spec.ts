/** @fileoverview 结果下载按钮的认证通路、重复点击与卸载清理。 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ModelingApi from '@/api/modeling'
import ResultView from '@/pages/Modeling/Canvas/components/ResultView.vue'

const { readFrame, saveBytes } = vi.hoisted(() => ({
  readFrame: vi.fn(),
  saveBytes: vi.fn(),
}))

vi.mock('@/api/modeling', async (original) => ({
  ...(await original<typeof ModelingApi>()),
  readModelingFrame: readFrame,
}))
vi.mock('@/utils/downloadJson', () => ({ downloadBytes: saveBytes }))

const PROPS = {
  payload: {
    frame: {
      kind: 'frame',
      shape: { rows: 1, cols: 0 },
      columns: [],
      index_head: [],
      head: [],
    },
  },
  runId: 'run',
  nodeId: 'node',
  exportedPorts: ['frame'],
}

beforeEach(() => {
  readFrame.mockReset()
  saveBytes.mockReset()
})

function deferred() {
  let resolve: (value: Blob) => void = () => undefined
  const promise = new Promise<Blob>((done) => {
    resolve = done
  })
  return { promise, resolve: (value: Blob) => resolve(value) }
}

describe('全量结果下载交互', () => {
  it('点击下载走认证 API 客户端，再保存返回的 CSV', async () => {
    const blob = new Blob(['a\n1\n'], { type: 'text/csv' })
    readFrame.mockResolvedValue(blob)
    const wrapper = mount(ResultView, { props: PROPS })
    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '下载全量结果')
    expect(button?.exists()).toBe(true)
    await button?.trigger('click')
    await flushPromises()
    expect(readFrame).toHaveBeenCalledWith(
      { runId: 'run', nodeId: 'node', port: 'frame' },
      expect.any(AbortSignal),
    )
    expect(saveBytes).toHaveBeenCalledWith(
      blob,
      expect.stringContaining('.csv'),
    )
    expect(wrapper.find('a[href^="/api/"]').exists()).toBe(false)
  })

  it('进行中显示状态并拒绝重复下载', async () => {
    const pending = deferred()
    readFrame.mockReturnValue(pending.promise)
    const wrapper = mount(ResultView, { props: PROPS })
    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '下载全量结果')
    expect(button?.exists()).toBe(true)
    await button?.trigger('click')
    await button?.trigger('click')
    expect(wrapper.text()).toContain('下载中')
    expect(readFrame).toHaveBeenCalledTimes(1)
    pending.resolve(new Blob(['a\n1\n']))
    await flushPromises()
    expect(wrapper.text()).not.toContain('下载中')
  })

  it('失败显示后端原因并允许重试', async () => {
    readFrame.mockRejectedValue(new Error('这份全量结果已过期'))
    const wrapper = mount(ResultView, { props: PROPS })
    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '下载全量结果')
    expect(button?.exists()).toBe(true)
    await button?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('这份全量结果已过期')
    expect(saveBytes).not.toHaveBeenCalled()
  })

  it('卸载后中止请求，迟到响应不再触发文件保存', async () => {
    const pending = deferred()
    readFrame.mockReturnValue(pending.promise)
    const wrapper = mount(ResultView, { props: PROPS })
    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '下载全量结果')
    expect(button?.exists()).toBe(true)
    await button?.trigger('click')
    const signal: unknown = readFrame.mock.calls[0]?.[1]
    expect(signal).toBeInstanceOf(AbortSignal)
    wrapper.unmount()
    if (!(signal instanceof AbortSignal))
      throw new Error('下载请求未接中止信号')
    expect(signal.aborted).toBe(true)
    pending.resolve(new Blob(['a\n1\n']))
    await flushPromises()
    expect(saveBytes).not.toHaveBeenCalled()
  })

  it('切换运行后取消旧下载，迟到响应不保存到新运行名下', async () => {
    const pending = deferred()
    readFrame.mockReturnValue(pending.promise)
    const wrapper = mount(ResultView, { props: PROPS })
    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '下载全量结果')
    await button?.trigger('click')
    const signal: unknown = readFrame.mock.calls[0]?.[1]
    if (!(signal instanceof AbortSignal))
      throw new Error('下载请求未接中止信号')

    await wrapper.setProps({ runId: 'another-run' })
    expect(signal.aborted).toBe(true)
    expect(wrapper.text()).not.toContain('下载中')
    pending.resolve(new Blob(['a\n1\n']))
    await flushPromises()
    expect(saveBytes).not.toHaveBeenCalled()
  })
})
