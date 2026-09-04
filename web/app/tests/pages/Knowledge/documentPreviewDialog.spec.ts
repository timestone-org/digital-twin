/**
 * @fileoverview 原件预览弹窗：取字节、画出来、下载，以及几条只有挂起来才逮得到的事。
 *
 * ⚠ 有一条盯的是「关掉再点同一份文档打不开」：`document` 没变的话侦听不触发，
 * 而那个空白弹窗看着像是接口坏了。
 * ⚠ 还有一条盯的是「下载又打一次接口」：字节已经在手上，再打一次是白花的
 * 一次往返，而在几十 MB 的手册上那一次要等好几秒。
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeDocument } from '@/api/knowledge'

import KnowledgeDocumentPreview from '@/pages/Knowledge/components/KnowledgeDocumentPreview.vue'

const api = vi.hoisted(() => ({ readDocumentRaw: vi.fn() }))
vi.mock('@/api/knowledge', () => api)

const clicked: { href: string; download: string }[] = []

beforeEach(() => {
  api.readDocumentRaw.mockReset()
  api.readDocumentRaw.mockResolvedValue(new Blob(['# 标题\n正文']))
  clicked.length = 0
  // happy-dom 没有 object URL，也不会真的下载：桩掉之后才数得出点了几次
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:fake/raw',
    revokeObjectURL: () => undefined,
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download })
  })
})

function documentOf(patch: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: 'd1',
    title: '冷却水系统手册.md',
    status: 'ready',
    failureReason: '',
    chunkCount: 3,
    sizeBytes: 2048,
    hasRaw: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    readyAt: '2026-09-01T00:01:00.000Z',
    ...patch,
  }
}

async function render(
  props: { modelValue: boolean; document: KnowledgeDocument | null } = {
    modelValue: true,
    document: documentOf(),
  },
): Promise<VueWrapper> {
  const wrapper = mount(KnowledgeDocumentPreview, {
    props,
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}

describe('原件预览弹窗', () => {
  it('打开时取一次字节并把正文画出来', async () => {
    const wrapper = await render()

    expect(api.readDocumentRaw.mock.calls[0]?.[0]).toBe('d1')
    expect(wrapper.text()).toContain('正文')
  })

  it('关着的时候一个字节都不取', async () => {
    await render({ modelValue: false, document: documentOf() })

    expect(api.readDocumentRaw).not.toHaveBeenCalled()
  })

  it('⚠ 后端那句话原样摆出来，不换成一句通用话', async () => {
    api.readDocumentRaw.mockRejectedValue(
      new Error('这份文档来自外部系统，没有可看的原件'),
    )

    const wrapper = await render()

    expect(wrapper.text()).toContain('这份文档来自外部系统，没有可看的原件')
  })

  it('⚠ 下载用手上那份字节，不再打一次接口', async () => {
    const wrapper = await render()

    const download = wrapper
      .findAll('button')
      .find((one) => one.text().includes('下载原件'))
    await download?.trigger('click')

    expect(api.readDocumentRaw).toHaveBeenCalledTimes(1)
    expect(clicked[0]?.download).toBe('冷却水系统手册.md')
  })

  it('⚠ 换一份文档要重新取，不许接着摆上一份的内容', async () => {
    const wrapper = await render()
    api.readDocumentRaw.mockResolvedValue(new Blob(['另一份的正文']))

    await wrapper.setProps({ document: documentOf({ id: 'd2' }) })
    await flushPromises()

    expect(api.readDocumentRaw.mock.calls[1]?.[0]).toBe('d2')
    expect(wrapper.text()).toContain('另一份的正文')
  })

  it('⚠ 关掉时把在飞的那次中止掉，它之后返回也不许再写状态', async () => {
    const wrapper = await render()
    const signal = api.readDocumentRaw.mock.calls[0]?.[1] as AbortSignal

    await wrapper.setProps({ modelValue: false })

    expect(signal.aborted).toBe(true)
  })

  it('画不出来的格式如实说一句，并且照样能下载', async () => {
    const wrapper = await render({
      modelValue: true,
      document: documentOf({ title: '汇报.pptx' }),
    })

    expect(wrapper.text()).toContain('这个格式没法在页面里预览')
    expect(wrapper.text()).toContain('下载原件')
  })
})
