/** @fileoverview Word 预览禁用外部 HTML，并阻止旧渲染覆盖新报告。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Component from '@/components/documents/DocumentPreviewDocx.vue'
const renderer = vi.hoisted(() => ({ renderAsync: vi.fn() }))
vi.mock('docx-preview', () => renderer)
afterEach(() => vi.resetAllMocks())
describe('Word 预览', () => {
  it('关闭 altChunk，文档切换后旧渲染不得追加到新报告', async () => {
    let finish: (() => void) | undefined
    renderer.renderAsync
      .mockImplementationOnce(
        (_blob: Blob, host: HTMLElement) =>
          new Promise<void>((resolve) => {
            finish = () => {
              host.append('old')
              resolve()
            }
          }),
      )
      .mockImplementationOnce((_blob: Blob, host: HTMLElement) => {
        host.append('new')
        return Promise.resolve()
      })
    const wrapper = mount(Component, { props: { blob: new Blob(['old']) } })
    await flushPromises()
    await wrapper.setProps({ blob: new Blob(['new']) })
    await flushPromises()
    finish?.()
    await flushPromises()
    expect(wrapper.text()).toContain('new')
    expect(wrapper.text()).not.toContain('old')
    expect(wrapper.emitted('rendered')).toHaveLength(1)
    expect(renderer.renderAsync.mock.calls[0]?.[3]).toMatchObject({
      renderAltChunks: false,
      useBase64URL: true,
    })
    wrapper.unmount()
  })
  it('渲染失败显示下载提示', async () => {
    renderer.renderAsync.mockRejectedValue(new Error('bad zip'))
    const wrapper = mount(Component, { props: { blob: new Blob(['bad']) } })
    await flushPromises()
    expect(wrapper.text()).toContain('可以下载原件')
    wrapper.unmount()
  })
})
