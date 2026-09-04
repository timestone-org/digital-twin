/**
 * @fileoverview Word 原件的画法。
 *
 * ⚠ 这条盯的是「弹窗永远在转圈」：`immediate` 的第一次侦听是在 setup 期间
 * **同步**跑的，`flush: 'post'` 对它不生效——那一刻容器还没挂上，早退一次
 * 加载态就再也不会被清掉。真浏览器里逮到的，happy-dom 下同样复现。
 *
 * ⚠ 另一条盯的是安全边界：`renderAltChunks` 默认是**开的**，而 altChunk 是
 * .docx 里可以夹一整段 HTML 的口子，docx-preview 把它画成一个不带 sandbox 的
 * `<iframe srcdoc>`——那个 iframe 继承本页的源。关不掉就是一次存储型 XSS。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentPreviewDocx from '@/pages/Knowledge/components/DocumentPreviewDocx.vue'

const docx = vi.hoisted(() => ({ renderAsync: vi.fn() }))
vi.mock('docx-preview', () => docx)

beforeEach(() => {
  docx.renderAsync.mockReset()
  docx.renderAsync.mockImplementation((_blob: Blob, box: HTMLElement) => {
    box.append(document.createElement('section'))
    return Promise.resolve()
  })
})

async function render() {
  const wrapper = mount(DocumentPreviewDocx, {
    props: { blob: new Blob(['docx']) },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('Word 原件的画法', () => {
  it('⚠ 画完之后加载态要消失，不许一直转圈', async () => {
    const wrapper = await render()

    expect(docx.renderAsync).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.dt-spinner').exists()).toBe(false)
  })

  it('⚠ altChunk 一律不画：那是 .docx 往本站源里塞 HTML 的口子', async () => {
    await render()

    const options = docx.renderAsync.mock.calls[0]?.[3] as Record<
      string,
      unknown
    >
    expect(options.renderAltChunks).toBe(false)
  })

  it('画不出来时说一句人话，而不是停在加载态', async () => {
    docx.renderAsync.mockRejectedValue(new Error('Invalid docx'))

    const wrapper = await render()

    expect(wrapper.text()).toContain('这份 Word 文档画不出来')
    expect(wrapper.find('.dt-spinner').exists()).toBe(false)
  })
})
