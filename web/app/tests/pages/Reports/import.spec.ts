/** @fileoverview Word 导入的进度、丢失清单、创建与取消。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DtButton, DtFilePicker, DtInput } from '@dt/ui'
import type { ReportRenderDetail, ReportTemplate } from '@dt/contracts'
import * as api from '@/api/reports'
import ImportDialog from '@/pages/Reports/Templates/components/ImportDialog.vue'

const stamp = '2026-08-01T00:00:00.000Z'
function job(status: ReportRenderDetail['status']): ReportRenderDetail {
  return {
    id: 'j1',
    template_id: null,
    schedule_id: null,
    period: '',
    granularity: 'month',
    timezone: 'UTC',
    kind: 'import',
    status,
    warnings: [],
    error: null,
    created_at: stamp,
    started_at: null,
    finished_at: null,
    preview: null,
    imported:
      status === 'succeeded'
        ? {
            doc_json: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '导入正文' }],
                },
              ],
            },
            page_json: {},
            dropped: ['批注未导入'],
          }
        : null,
  }
}
function report(): ReportTemplate {
  return {
    id: 'r1',
    code: 'imported',
    name: '月报',
    description: null,
    granularity: 'month',
    is_enabled: true,
    row_version: 1,
    created_at: stamp,
    updated_at: stamp,
    doc_json: { type: 'doc' },
    metrics: [],
    page_json: {},
  }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Word 导入', () => {
  it('展示丢失清单后用实际正文创建模板', async () => {
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender').mockResolvedValue(job('succeeded'))
    vi.spyOn(api, 'createReport').mockResolvedValue(report())
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['Word'], '月报.docx')])
    await flushPromises()
    expect(wrapper.text()).toContain('批注未导入')
    wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '模板编码')
      ?.vm.$emit('update:modelValue', 'imported')
    await flushPromises()
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '使用导入内容创建模板')
      ?.trigger('click')
    await flushPromises()
    expect(api.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '月报',
        code: 'imported',
        doc_json: expect.objectContaining({ content: expect.any(Array) }),
      }),
    )
    expect(wrapper.emitted('created')?.[0]?.[0]).toEqual(report())
    wrapper.unmount()
  })
  it('不接受非 Word 文件，失败状态保持可见', async () => {
    vi.spyOn(api, 'importReport').mockRejectedValue(new Error('network'))
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], 'file.exe')])
    await flushPromises()
    expect(wrapper.text()).toContain('请选择不超过 10 MB')
    expect(api.importReport).not.toHaveBeenCalled()
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], 'file.docx')])
    await flushPromises()
    expect(wrapper.text()).toContain('请求失败')
    wrapper.unmount()
  })
  it('后台转换失败显示原因，关弹窗停止轮询', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender')
      .mockResolvedValueOnce(job('running'))
      .mockResolvedValueOnce({ ...job('failed'), error: '文档结构损坏' })
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], 'file.docx')])
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.text()).toContain('文档结构损坏')
    await wrapper.setProps({ modelValue: false })
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.getReportRender).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
