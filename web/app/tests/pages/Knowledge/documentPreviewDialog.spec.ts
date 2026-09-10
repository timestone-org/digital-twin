/**
 * @fileoverview 原件预览弹窗：取字节、画出来、下载，以及几条只有挂起来才逮得到的事。
 *
 * ⚠ 有一条盯的是「关掉再点同一份文档打不开」：`document` 没变的话侦听不触发，
 * 而那个空白弹窗看着像是接口坏了。
 * ⚠ 下载原件按需取：兼容预览复用手上的 DOCX，PDF 预览第一次下载后缓存原件，
 * 都不许为同一次下载重复走接口。
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { KnowledgeDocument } from '@/api/knowledge'

import KnowledgeDocumentPreview from '@/pages/Knowledge/components/KnowledgeDocumentPreview.vue'

const api = vi.hoisted(() => ({
  readDocumentPreview: vi.fn(),
  readDocumentRaw: vi.fn(),
}))
vi.mock('@/api/knowledge', () => api)

const StageStub = defineComponent({
  name: 'DocumentPreviewStage',
  props: {
    blob: { type: Blob, required: true },
    kind: { type: String, required: true },
    name: { type: String, required: true },
    text: { type: String, required: true },
  },
  template: '<div data-test="preview-stage" />',
})

const clicked: { href: string; download: string }[] = []
const objectUrlInputs: Blob[] = []

beforeEach(() => {
  api.readDocumentRaw.mockReset()
  api.readDocumentRaw.mockResolvedValue(new Blob(['# 标题\n正文']))
  api.readDocumentPreview.mockReset()
  api.readDocumentPreview.mockResolvedValue(
    new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
  )
  clicked.length = 0
  objectUrlInputs.length = 0
  // happy-dom 没有 object URL，也不会真的下载：桩掉之后才数得出点了几次
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      objectUrlInputs.push(blob)
      return 'blob:fake/raw'
    },
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
  stubStage = false,
): Promise<VueWrapper> {
  const wrapper = mount(KnowledgeDocumentPreview, {
    props,
    attachTo: document.body,
    global: {
      stubs: {
        Teleport: true,
        ...(stubStage ? { DocumentPreviewStage: StageStub } : {}),
      },
    },
  })
  await flushPromises()
  return wrapper
}

async function stagedText(wrapper: VueWrapper): Promise<string> {
  const blob: unknown = wrapper.getComponent(StageStub).props('blob')
  if (!(blob instanceof Blob)) throw new Error('预览画布没有收到 Blob')
  return await blob.text()
}

describe('原件预览弹窗', () => {
  it('打开时取一次字节并把正文画出来', async () => {
    const wrapper = await render()

    expect(api.readDocumentRaw.mock.calls[0]?.[0]).toBe('d1')
    expect(wrapper.text()).toContain('正文')
  })

  it('Word 优先画服务端的 PDF 派生预览，让文档图形不被浏览器渲染器跳过', async () => {
    const derived = new Blob(['%PDF-1.7\nderived'], {
      type: 'application/pdf',
    })
    api.readDocumentPreview.mockResolvedValue(derived)
    const wrapper = await render(
      {
        modelValue: true,
        document: documentOf({ title: '冷却水系统图.docx' }),
      },
      true,
    )

    expect(api.readDocumentPreview).toHaveBeenCalledWith(
      'd1',
      expect.any(AbortSignal),
    )
    const stage = wrapper.getComponent(StageStub)
    expect(stage.props('kind')).toBe('pdf')
    expect(await stagedText(wrapper)).toBe('%PDF-1.7\nderived')
    expect(api.readDocumentRaw).not.toHaveBeenCalled()
  })

  it('服务端回兼容 DOCX 时直接显示且不重复下载原件', async () => {
    const fallback = new Blob(['fallback-docx'], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    api.readDocumentPreview.mockResolvedValue(fallback)

    const wrapper = await render(
      {
        modelValue: true,
        document: documentOf({ title: '冷却水系统图.docx' }),
      },
      true,
    )

    const stage = wrapper.getComponent(StageStub)
    expect(stage.props('kind')).toBe('docx')
    expect(await stagedText(wrapper)).toBe('fallback-docx')
    expect(api.readDocumentRaw).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('复杂图形可能显示不完整')
  })

  it('旧后端没有派生端点时退回原 DOCX', async () => {
    api.readDocumentRaw.mockResolvedValue(
      new Blob(['docx'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    )
    api.readDocumentPreview.mockRejectedValue(new Error('旧后端没有这个端点'))

    const wrapper = await render(
      {
        modelValue: true,
        document: documentOf({ title: '冷却水系统图.docx' }),
      },
      true,
    )

    expect(wrapper.getComponent(StageStub).props('kind')).toBe('docx')
    expect(api.readDocumentRaw).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('复杂图形可能显示不完整')
  })

  it('Word 即使画的是 PDF，下载拿到的仍是原 DOCX', async () => {
    api.readDocumentRaw.mockResolvedValue(
      new Blob(['docx'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    )
    const wrapper = await render(
      {
        modelValue: true,
        document: documentOf({ title: '冷却水系统图.docx' }),
      },
      true,
    )

    const download = wrapper
      .findAll('button')
      .find((one) => one.text().includes('下载原件'))
    await download?.trigger('click')
    await flushPromises()

    expect(objectUrlInputs[0]?.type).toContain('wordprocessingml.document')
    expect(clicked[0]?.download).toBe('冷却水系统图.docx')
    expect(api.readDocumentRaw).toHaveBeenCalledTimes(1)

    await download?.trigger('click')
    expect(api.readDocumentRaw).toHaveBeenCalledTimes(1)
  })

  it('PDF 预览下载原件失败时保留预览并给出原因', async () => {
    api.readDocumentRaw.mockRejectedValue(new Error('原件下载失败'))
    const wrapper = await render(
      {
        modelValue: true,
        document: documentOf({ title: '冷却水系统图.docx' }),
      },
      true,
    )
    const download = wrapper
      .findAll('button')
      .find((one) => one.text().includes('下载原件'))

    await download?.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="preview-stage"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('原件下载失败')
    expect(download?.attributes('aria-busy')).toBeUndefined()
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

  it('关掉 PDF 预览时也中止正在下载的原件', async () => {
    api.readDocumentRaw.mockReturnValue(new Promise<Blob>(() => undefined))
    const wrapper = await render(
      {
        modelValue: true,
        document: documentOf({ title: '系统图.docx' }),
      },
      true,
    )
    const download = wrapper
      .findAll('button')
      .find((one) => one.text().includes('下载原件'))
    await download?.trigger('click')
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
