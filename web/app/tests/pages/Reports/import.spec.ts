/** @fileoverview Word 导入的进度、丢失清单、创建与取消。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DtButton, DtFilePicker, DtInput } from '@dt/ui'
import type { ReportRenderDetail, ReportTemplate } from '@dt/contracts'
import * as api from '@/api/reports'
import ImportDialog from '@/pages/Reports/Templates/components/ImportDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { readImportRecovery } from '@/pages/Reports/Templates/scripts/importRecovery'

const stamp = '2026-08-01T00:00:00.000Z'
function signIn(id: string): void {
  useAuthStore().user = {
    id,
    username: id,
    email: '',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: stamp,
    updated_at: stamp,
    role: { id: 'r', name: 'admin', description: null, is_builtin: true },
    permissions: ['report:view', 'report:manage'],
    direct_permissions: [],
    role_permissions: ['report:view', 'report:manage'],
  }
}
beforeEach(() => {
  window.sessionStorage.clear()
  setActivePinia(createPinia())
  signIn('import-user')
})
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
  it('刷新后继续查询已上传任务，并恢复创建模板名称编码', async () => {
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender').mockResolvedValue(job('succeeded'))
    const first = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    first
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], '月报.docx')])
    await flushPromises()
    first
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '模板编码')
      ?.vm.$emit('update:modelValue', 'restored')
    await flushPromises()
    expect(readImportRecovery('import-user')).toEqual({
      jobId: 'j1',
      name: '月报',
      code: 'restored',
    })
    first.unmount()
    const reopened = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    expect(api.importReport).toHaveBeenCalledTimes(1)
    expect(api.getReportRender).toHaveBeenCalledTimes(2)
    expect(reopened.text()).toContain('批注未导入')
    expect(
      reopened
        .findAllComponents(DtInput)
        .find((input) => input.props('label') === '模板编码')
        ?.props('modelValue'),
    ).toBe('restored')
    reopened.unmount()
  })
  it('切换账号不恢复其他账号的任务，切回本人可继续', async () => {
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender')
      .mockResolvedValueOnce(job('pending'))
      .mockResolvedValue(job('succeeded'))
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], '月报.docx')])
    await flushPromises()
    signIn('other-user')
    await flushPromises()
    expect(api.getReportRender).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('文件已上传，等待后台转换')
    signIn('import-user')
    await flushPromises()
    expect(api.getReportRender).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('批注未导入')
    wrapper.unmount()
  })
  it('已上传但尚未被后台领取时显示等待转换', async () => {
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender').mockResolvedValue(job('pending'))
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], 'file.docx')])
    await flushPromises()
    expect(wrapper.text()).toContain('文件已上传，等待后台转换')
    expect(wrapper.text()).toContain('关闭窗口不会取消后台任务')
    wrapper.unmount()
  })
  it('查询断开可继续查看当前任务，无需重复上传', async () => {
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(job('succeeded'))
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], 'file.docx')])
    await flushPromises()
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '继续查看转换进度')
      ?.trigger('click')
    await flushPromises()
    expect(api.importReport).toHaveBeenCalledTimes(1)
    expect(api.getReportRender).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('批注未导入')
    wrapper.unmount()
  })
  it('关闭后重新打开会恢复当前任务进度', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender')
      .mockResolvedValueOnce(job('pending'))
      .mockResolvedValue(job('succeeded'))
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], 'file.docx')])
    await flushPromises()
    await wrapper.setProps({ modelValue: false })
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.getReportRender).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(api.getReportRender).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('批注未导入')
    wrapper.unmount()
  })
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
    expect(readImportRecovery('import-user')).toBeNull()
    wrapper.unmount()
  })
  it('存储不可用时仍可导入，提示保持页面打开', async () => {
    vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender').mockResolvedValue(job('succeeded'))
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], '月报.docx')])
    await flushPromises()
    expect(wrapper.text()).toContain('浏览器未能保存恢复记录')
    expect(wrapper.text()).toContain('批注未导入')
    wrapper.unmount()
  })
  it('明确放弃后清除恢复记录，刷新不再接续该任务', async () => {
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender').mockResolvedValue(job('pending'))
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], '月报.docx')])
    await flushPromises()
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '放弃此次导入')
      ?.trigger('click')
    expect(readImportRecovery('import-user')).toBeNull()
    wrapper.unmount()
    const reopened = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    expect(api.getReportRender).toHaveBeenCalledTimes(1)
    expect(reopened.text()).not.toContain('文件已上传，等待后台转换')
    reopened.unmount()
  })
  it('后台返回成功却没有导入结果时明确报告结果不可用', async () => {
    vi.spyOn(api, 'importReport').mockResolvedValue(job('pending'))
    vi.spyOn(api, 'getReportRender').mockResolvedValue({
      ...job('succeeded'),
      imported: null,
    })
    const wrapper = mount(ImportDialog, {
      props: { modelValue: true },
      global: { stubs: { teleport: true } },
    })
    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['x'], 'file.docx')])
    await flushPromises()
    expect(wrapper.text()).toContain('转换任务未返回可用结果')
    expect(wrapper.findAllComponents(DtInput)).toHaveLength(0)
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
