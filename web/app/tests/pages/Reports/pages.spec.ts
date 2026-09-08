/** @fileoverview 报告页面的列表、创建、轮询与权限门禁。 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DtButton,
  DtCursorPager,
  DtInput,
  DtSelect,
  DtModal,
  useConfirm,
} from '@dt/ui'
import type {
  AuthUser,
  ReportRender,
  ReportTemplate,
  ReportTemplateSummary,
  ReportSchedule,
} from '@dt/contracts'
import * as api from '@/api/reports'
import * as downloads from '@/utils/downloadJson'
import ImportDialog from '@/pages/Reports/Templates/components/ImportDialog.vue'
import { BizError } from '@/api/client'
import Templates from '@/pages/Reports/Templates/index.vue'
import Renders from '@/pages/Reports/Renders/index.vue'
import Schedules from '@/pages/Reports/Schedules/index.vue'
import { useAuthStore } from '@/stores/auth'

const routing = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('vue-router', () => ({
  useRouter: () => routing,
  useRoute: () => ({ path: '/reports', query: {}, params: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))
const stamp = '2026-08-01T00:00:00.000Z'
function summary(): ReportTemplateSummary {
  return {
    id: 'r1',
    code: 'energy',
    name: '能耗月报',
    description: null,
    granularity: 'month',
    is_enabled: true,
    row_version: 1,
    created_at: stamp,
    updated_at: stamp,
  }
}
function report(): ReportTemplate {
  return { ...summary(), doc_json: { type: 'doc' }, metrics: [], page_json: {} }
}
function job(status: ReportRender['status'] = 'pending'): ReportRender {
  return {
    id: 'j1',
    template_id: 'r1',
    schedule_id: null,
    period: '2026-08',
    granularity: 'month',
    timezone: 'Asia/Shanghai',
    kind: 'render',
    status,
    warnings: [],
    error: null,
    created_at: stamp,
    started_at: null,
    finished_at: null,
  }
}
function signIn(permissions: string[]): void {
  const user: AuthUser = {
    id: 'u1',
    username: 'user',
    email: '',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: stamp,
    updated_at: stamp,
    role: { id: 'role', name: 'reader', description: null, is_builtin: false },
    permissions,
    role_permissions: permissions,
    direct_permissions: [],
  }
  const auth = useAuthStore()
  auth.user = user
  auth.accessToken = 'test-token'
}
beforeEach(() => {
  vi.spyOn(api, 'listReportChoices').mockResolvedValue([summary()])
  setActivePinia(createPinia())
  signIn(['report:view'])
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('报告页面', () => {
  it('只读用户能看列表但没有创建入口', async () => {
    vi.spyOn(api, 'listReports').mockResolvedValue({
      items: [summary()],
      page: 1,
      size: 20,
      total: 40,
    })
    const wrapper = mount(Templates, { global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('能耗月报')
    expect(wrapper.text()).not.toContain('新建模板')
    expect(wrapper.text()).not.toContain('导入 Word')
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '下一页')
      ?.trigger('click')
    await flushPromises()
    expect(api.listReports).toHaveBeenLastCalledWith(2)
    wrapper.unmount()
  })
  it('创建模板后进入对应编辑页', async () => {
    signIn(['report:view', 'report:manage'])
    vi.spyOn(api, 'listReports').mockResolvedValue({
      items: [],
      page: 1,
      size: 20,
      total: 0,
    })
    vi.spyOn(api, 'createReport').mockResolvedValue(report())
    const wrapper = mount(Templates, { global: { stubs: { teleport: true } } })
    await flushPromises()
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '新建模板')
      ?.trigger('click')
    wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '报告名称')
      ?.vm.$emit('update:modelValue', '能耗月报')
    wrapper
      .findAllComponents(DtInput)
      .find((input) => input.props('label') === '模板编码')
      ?.vm.$emit('update:modelValue', 'energy')
    await flushPromises()
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === '创建并编辑')
      ?.trigger('click')
    await flushPromises()
    expect(api.createReport).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'energy', name: '能耗月报' }),
    )
    expect(routing.push).toHaveBeenCalledWith('/reports/templates/r1')
    wrapper.unmount()
  })
  it('生成中自动刷新，卸载之后停止', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'listReportRenders').mockResolvedValue({
      items: [job()],
      next: null,
      has_more: false,
    })
    const wrapper = mount(Renders, { global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('排队中')
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.listReportRenders).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.listReportRenders).toHaveBeenCalledTimes(2)
  })
  it('定时规则显示真实的关闭状态', async () => {
    vi.spyOn(api, 'listReportSchedules').mockResolvedValue({
      items: [],
      page: 1,
      size: 20,
      total: 0,
    })
    vi.spyOn(api, 'listReports').mockResolvedValue({
      items: [summary()],
      page: 1,
      size: 20,
      total: 1,
    })
    vi.spyOn(api, 'reportRuntime').mockResolvedValue({
      is_schedule_enabled: false,
      timezone: 'Asia/Shanghai',
    })
    const wrapper = mount(Schedules, { global: { stubs: { teleport: true } } })
    await flushPromises()
    expect(wrapper.text()).toContain('总开关已关闭')
    expect(wrapper.text()).not.toContain('新建规则')
    wrapper.unmount()
  })
  it('生成记录使用游标分页器，并能返回上一页', async () => {
    vi.spyOn(api, 'listReportRenders').mockResolvedValue({
      items: [job('succeeded')],
      next: 'cursor',
      has_more: true,
    })
    const wrapper = mount(Renders, { global: { stubs: { teleport: true } } })
    await flushPromises()

    const pager = wrapper.findComponent(DtCursorPager)
    expect(pager.props()).toMatchObject({
      page: 1,
      count: 1,
      hasPrev: false,
      hasNext: true,
    })

    pager.vm.$emit('next')
    await flushPromises()
    expect(api.listReportRenders).toHaveBeenLastCalledWith('cursor')
    expect(pager.props('page')).toBe(2)

    pager.vm.$emit('prev')
    await flushPromises()
    expect(api.listReportRenders).toHaveBeenLastCalledWith(undefined)
    expect(pager.props('page')).toBe(1)
    wrapper.unmount()
  })
})

it('定时规则能创建、停用和删除', async () => {
  signIn(['report:view', 'report:schedule'])
  const rule: ReportSchedule = {
    id: 's1',
    template_id: 'r1',
    name: '月报',
    granularity: 'month',
    delay_hours: 24,
    is_enabled: true,
    row_version: 1,
    last_run_period: null,
    created_at: stamp,
    updated_at: stamp,
  }
  vi.spyOn(api, 'listReportSchedules').mockResolvedValue({
    items: [rule],
    page: 1,
    size: 20,
    total: 1,
  })
  vi.spyOn(api, 'listReports').mockResolvedValue({
    items: [summary()],
    page: 1,
    size: 20,
    total: 1,
  })
  vi.spyOn(api, 'reportRuntime').mockResolvedValue({
    is_schedule_enabled: true,
    timezone: 'UTC',
  })
  vi.spyOn(api, 'createReportSchedule').mockResolvedValue(rule)
  vi.spyOn(api, 'saveReportSchedule').mockResolvedValue({
    ...rule,
    is_enabled: false,
    row_version: 2,
  })
  vi.spyOn(api, 'deleteReportSchedule').mockResolvedValue({
    code: 0,
    message: 'ok',
    trace_id: 'trace',
    data: null,
  })
  const wrapper = mount(Schedules, { global: { stubs: { teleport: true } } })
  await flushPromises()
  async function click(label: string): Promise<void> {
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === label)
      ?.trigger('click')
    await flushPromises()
  }
  await click('新建规则')
  wrapper
    .findAllComponents(DtInput)
    .find((input) => input.props('label') === '规则名称')
    ?.vm.$emit('update:modelValue', '月报')
  wrapper
    .findAllComponents(DtInput)
    .find((input) => input.props('label') === '期末延迟小时数')
    ?.vm.$emit('update:modelValue', '12')
  wrapper
    .findAllComponents(DtSelect)
    .find((select) => select.props('label') === '报告模板')
    ?.vm.$emit('update:modelValue', 'r1')
  await flushPromises()
  await click('创建规则')
  expect(api.createReportSchedule).toHaveBeenCalledWith(
    expect.objectContaining({ template_id: 'r1', delay_hours: 12 }),
  )
  await click('停用')
  expect(api.saveReportSchedule).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({ is_enabled: false, expected_version: 1 }),
  )
  await click('删除')
  useConfirm().resolve(true)
  await flushPromises()
  expect(api.deleteReportSchedule).toHaveBeenCalledWith('s1')
  wrapper.unmount()
})

it('模板删除经过确认，创建失败和模态关闭可恢复', async () => {
  signIn(['report:view', 'report:manage'])
  vi.spyOn(api, 'listReports').mockResolvedValue({
    items: [summary()],
    page: 1,
    size: 20,
    total: 1,
  })
  vi.spyOn(api, 'deleteReport').mockResolvedValue({
    code: 0,
    message: 'ok',
    trace_id: 'trace',
    data: null,
  })
  vi.spyOn(api, 'createReport').mockRejectedValue(
    new BizError(41302, '编码重复', 409, 'trace'),
  )
  const wrapper = mount(Templates, { global: { stubs: { teleport: true } } })
  await flushPromises()
  async function click(label: string): Promise<void> {
    await wrapper
      .findAllComponents(DtButton)
      .find((button) => button.text() === label)
      ?.trigger('click')
    await flushPromises()
  }
  await click('删除')
  useConfirm().resolve(false)
  await flushPromises()
  expect(api.deleteReport).not.toHaveBeenCalled()
  await click('删除')
  useConfirm().resolve(true)
  await flushPromises()
  expect(api.deleteReport).toHaveBeenCalledWith('r1')
  await click('新建模板')
  for (const input of wrapper.findAllComponents(DtInput))
    input.vm.$emit('update:modelValue', 'energy')
  await flushPromises()
  await click('创建并编辑')
  expect(wrapper.text()).toContain('编码重复')
  wrapper
    .findAllComponents(DtModal)
    .find((modal) => modal.props('title') === '新建报告模板')
    ?.vm.$emit('update:modelValue', false)
  await click('导入 Word')
  expect(wrapper.text()).toContain('从 Word 导入报告模板')
  wrapper.findComponent(ImportDialog).vm.$emit('created', report())
  wrapper.findComponent(ImportDialog).vm.$emit('update:modelValue', false)
  expect(routing.push).toHaveBeenCalledWith('/reports/templates/r1')
  wrapper.unmount()
})

it('生成记录显示警告并把真实文件交给下载器', async () => {
  signIn(['report:view', 'report:render'])
  const blob = new Blob(['document'])
  vi.spyOn(api, 'listReportRenders').mockResolvedValue({
    items: [{ ...job('succeeded'), warnings: ['数据已截断'] }],
    next: null,
    has_more: false,
  })
  vi.spyOn(api, 'downloadReport').mockResolvedValue(blob)
  vi.spyOn(downloads, 'downloadBytes').mockImplementation(() => undefined)
  const wrapper = mount(Renders, { global: { stubs: { teleport: true } } })
  await flushPromises()
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '下载 Word')
    ?.trigger('click')
  await flushPromises()
  expect(downloads.downloadBytes).toHaveBeenCalledWith(blob, 'report-j1.docx')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '1 条提示')
    ?.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('数据已截断')
  wrapper.findComponent(DtModal).vm.$emit('update:modelValue', false)
  vi.mocked(api.downloadReport).mockRejectedValue(
    new BizError(41304, '产物不可用', 409, 'trace'),
  )
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '下载 Word')
    ?.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('产物不可用')
  await wrapper
    .findAllComponents(DtButton)
    .find((button) => button.text() === '刷新')
    ?.trigger('click')
  await flushPromises()
  wrapper.unmount()
})
