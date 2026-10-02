/** @fileoverview 定时规则编辑、版本保留、权限及表单边界。 */
import type {
  AuthUser,
  ReportSchedule,
  ReportTemplateSummary,
} from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtSelect, useConfirm } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/api/reports'
import { BizError } from '@/api/client'
import Schedules from '@/pages/Reports/Schedules/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ path: '/reports/schedules', query: {}, params: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const STAMP = '2026-08-01T00:00:00.000Z'
function rule(): ReportSchedule {
  return {
    id: 's1',
    template_id: 'r1',
    name: '季报规则',
    granularity: 'quarter',
    delay_hours: 48,
    is_enabled: false,
    row_version: 7,
    last_run_period: '2026-Q2',
    created_at: STAMP,
    updated_at: STAMP,
  }
}
function template(): ReportTemplateSummary {
  return {
    id: 'r1',
    code: 'energy',
    name: '能耗月报',
    description: null,
    granularity: 'month',
    is_enabled: true,
    row_version: 1,
    created_at: STAMP,
    updated_at: STAMP,
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
    created_at: STAMP,
    updated_at: STAMP,
    role: { id: 'role', name: 'writer', description: null, is_builtin: false },
    permissions,
    role_permissions: permissions,
    direct_permissions: [],
  }
  useAuthStore().user = user
  useAuthStore().accessToken = 'test-token'
}
const mounted: { unmount: () => void }[] = []
async function open() {
  const wrapper = mount(Schedules, { global: { stubs: { teleport: true } } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(
  wrapper: Awaited<ReturnType<typeof open>>,
  label: string,
  index = 0,
) {
  const found = wrapper
    .findAllComponents(DtButton)
    .filter((item) => item.text() === label)[index]
  if (!found) throw new Error(`缺少按钮：${label}`)
  return found
}
function modal(wrapper: Awaited<ReturnType<typeof open>>, title: string) {
  const found = wrapper
    .findAllComponents(DtModal)
    .find((item) => item.props('title') === title)
  if (!found) throw new Error(`缺少弹窗：${title}`)
  return found
}
async function setField(
  dialog: ReturnType<typeof modal>,
  label: string,
  value: string,
) {
  const field = dialog
    .findAllComponents(DtInput)
    .find((item) => item.props('label') === label)
  if (!field) throw new Error(`缺少字段：${label}`)
  field.vm.$emit('update:modelValue', value)
  await flushPromises()
}
async function openEdit() {
  const wrapper = await open()
  await button(wrapper, '编辑').trigger('click')
  await flushPromises()
  return { wrapper, dialog: modal(wrapper, '编辑定时规则') }
}
async function openCreate() {
  const wrapper = await open()
  await button(wrapper, '新建规则').trigger('click')
  const dialog = modal(wrapper, '新建定时规则')
  await setField(dialog, '规则名称', '月报')
  dialog.findComponent(DtSelect).vm.$emit('update:modelValue', 'r1')
  await flushPromises()
  return { wrapper, dialog }
}

beforeEach(() => {
  setActivePinia(createPinia())
  signIn(['report:view', 'report:schedule'])
  vi.spyOn(api, 'listReportSchedules').mockResolvedValue({
    items: [rule()],
    page: 1,
    size: 20,
    total: 1,
  })
  vi.spyOn(api, 'listReportChoices').mockResolvedValue([template()])
  vi.spyOn(api, 'reportRuntime').mockResolvedValue({
    is_schedule_enabled: false,
    timezone: 'UTC',
  })
  vi.spyOn(api, 'createReportSchedule').mockResolvedValue(rule())
  vi.spyOn(api, 'deleteReportSchedule').mockResolvedValue(undefined)
  vi.spyOn(api, 'saveReportSchedule').mockResolvedValue({
    ...rule(),
    row_version: 8,
  })
})
afterEach(() => {
  useConfirm().resolve(false)
  while (mounted.length) mounted.pop()?.unmount()
  vi.restoreAllMocks()
})

describe('定时规则行级动作', () => {
  it('启停等待期间同记录动作互斥，其他记录可以继续操作，成功后解锁', async () => {
    vi.mocked(api.listReportSchedules).mockResolvedValue({
      items: [rule(), { ...rule(), id: 's2' }],
      page: 1,
      size: 20,
      total: 2,
    })
    let finish: ((row: ReportSchedule) => void) | undefined
    vi.mocked(api.saveReportSchedule).mockImplementation((id) =>
      id === 's1'
        ? new Promise((resolve) => {
            finish = resolve
          })
        : Promise.resolve(rule()),
    )
    const wrapper = await open()
    button(wrapper, '启用').vm.$emit('click')
    button(wrapper, '启用').vm.$emit('click')
    button(wrapper, '删除').vm.$emit('click')
    button(wrapper, '编辑').vm.$emit('click')
    await flushPromises()
    expect(api.saveReportSchedule).toHaveBeenCalledTimes(1)
    expect(useConfirm().pending.value).toBeNull()
    expect(modal(wrapper, '编辑定时规则').props('modelValue')).toBe(false)
    for (const label of ['编辑', '启用', '删除']) {
      expect(button(wrapper, label).props('disabled')).toBe(true)
      expect(button(wrapper, label, 1).props('disabled')).toBe(false)
    }
    button(wrapper, '启用', 1).vm.$emit('click')
    await flushPromises()
    expect(api.saveReportSchedule).toHaveBeenCalledTimes(2)
    finish?.(rule())
    await flushPromises()
    expect(button(wrapper, '启用').props('disabled')).toBe(false)
  })

  it('启停失败显示原因并解锁，可再次操作', async () => {
    vi.mocked(api.saveReportSchedule).mockRejectedValueOnce(
      new BizError(41302, '启停失败', 409, 'trace'),
    )
    const wrapper = await open()
    await button(wrapper, '启用').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('启停失败')
    expect(button(wrapper, '启用').props('disabled')).toBe(false)
    await button(wrapper, '启用').trigger('click')
    await flushPromises()
    expect(api.saveReportSchedule).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('启停失败')
  })

  it('删除确认等待期间锁住同记录，重复点击不替换确认；取消后解锁', async () => {
    const wrapper = await open()
    button(wrapper, '删除').vm.$emit('click')
    const first = useConfirm().pending.value?.id
    button(wrapper, '删除').vm.$emit('click')
    button(wrapper, '启用').vm.$emit('click')
    await flushPromises()
    expect(useConfirm().pending.value?.id).toBe(first)
    expect(api.saveReportSchedule).not.toHaveBeenCalled()
    expect(button(wrapper, '删除').props('disabled')).toBe(true)
    useConfirm().resolve(false)
    await flushPromises()
    expect(api.deleteReportSchedule).not.toHaveBeenCalled()
    expect(button(wrapper, '删除').props('disabled')).toBe(false)
  })

  it.each([false, true])(
    '删除响应失败=%s 时仍只发一次，结束后解锁',
    async (isFailed) => {
      let finish: (() => void) | undefined
      vi.mocked(api.deleteReportSchedule).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = () =>
              isFailed
                ? reject(new BizError(41302, '删除失败', 409, 'trace'))
                : resolve(undefined)
          }),
      )
      const wrapper = await open()
      button(wrapper, '删除').vm.$emit('click')
      useConfirm().resolve(true)
      await flushPromises()
      button(wrapper, '删除').vm.$emit('click')
      button(wrapper, '启用').vm.$emit('click')
      await flushPromises()
      expect(api.deleteReportSchedule).toHaveBeenCalledTimes(1)
      expect(api.saveReportSchedule).not.toHaveBeenCalled()
      expect(useConfirm().pending.value).toBeNull()
      expect(button(wrapper, '删除').props('disabled')).toBe(true)
      finish?.()
      await flushPromises()
      expect(button(wrapper, '删除').props('disabled')).toBe(false)
      if (isFailed) expect(wrapper.text()).toContain('删除失败')
      else expect(api.listReportSchedules).toHaveBeenCalledTimes(2)
    },
  )
})

describe('定时规则编辑', () => {
  it('编辑回填名称和延迟；保存保持原模板、周期、启停和预期版本', async () => {
    const { wrapper, dialog } = await openEdit()
    expect(
      dialog
        .findAllComponents(DtInput)
        .find((item) => item.props('label') === '规则名称')
        ?.props('modelValue'),
    ).toBe('季报规则')
    expect(
      dialog
        .findAllComponents(DtInput)
        .find((item) => item.props('label') === '期末延迟小时数')
        ?.props('modelValue'),
    ).toBe('48')
    expect(
      dialog
        .findAllComponents(DtInput)
        .find((item) => item.props('label') === '报告模板')
        ?.props(),
    ).toMatchObject({ modelValue: '能耗月报', disabled: true })
    await setField(dialog, '规则名称', '  新名称  ')
    await setField(dialog, '期末延迟小时数', '12')
    await button(wrapper, '保存规则').trigger('click')
    await flushPromises()
    expect(api.saveReportSchedule).toHaveBeenCalledWith('s1', {
      name: '新名称',
      delay_hours: 12,
      granularity: 'quarter',
      is_enabled: false,
      expected_version: 7,
    })
    expect(api.createReportSchedule).not.toHaveBeenCalled()
    expect(dialog.props('modelValue')).toBe(false)
    expect(api.listReportSchedules).toHaveBeenCalledTimes(2)
  })

  it('取消不保存，再次编辑回填原记录', async () => {
    const { wrapper, dialog } = await openEdit()
    await setField(dialog, '规则名称', '取消的草稿')
    await button(wrapper, '取消').trigger('click')
    expect(api.saveReportSchedule).not.toHaveBeenCalled()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    expect(
      dialog
        .findAllComponents(DtInput)
        .find((item) => item.props('label') === '规则名称')
        ?.props('modelValue'),
    ).toBe('季报规则')
  })

  it('保存中重复点击只发一次，忙碌时不可关闭或改字段', async () => {
    let finish: ((row: ReportSchedule) => void) | undefined
    vi.mocked(api.saveReportSchedule).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const { wrapper, dialog } = await openEdit()
    button(wrapper, '保存规则').vm.$emit('click', new MouseEvent('click'))
    button(wrapper, '保存规则').vm.$emit('click', new MouseEvent('click'))
    await flushPromises()
    expect(api.saveReportSchedule).toHaveBeenCalledTimes(1)
    expect(button(wrapper, '保存规则').props('loading')).toBe(true)
    expect(button(wrapper, '取消').attributes('disabled')).toBeDefined()
    dialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(dialog.props('modelValue')).toBe(true)
    expect(dialog.findComponent(DtInput).props('disabled')).toBe(true)
    finish?.({ ...rule(), row_version: 8 })
    await flushPromises()
    expect(dialog.props('modelValue')).toBe(false)
  })

  it('版本冲突在弹窗内可见，保留草稿和旧版本；不会自动重试', async () => {
    vi.mocked(api.saveReportSchedule).mockRejectedValue(
      new BizError(41302, '规则已被其他人修改，请重新加载', 409, 'trace'),
    )
    const { wrapper, dialog } = await openEdit()
    await setField(dialog, '规则名称', '待保存草稿')
    await button(wrapper, '保存规则').trigger('click')
    await flushPromises()
    expect(dialog.text()).toContain('规则已被其他人修改，请重新加载')
    expect(dialog.props('modelValue')).toBe(true)
    expect(button(wrapper, '保存规则').props('loading')).toBe(false)
    expect(api.saveReportSchedule).toHaveBeenCalledTimes(1)
    expect(dialog.findComponent(DtInput).props('modelValue')).toBe('待保存草稿')
    await button(wrapper, '取消').trigger('click')
    vi.mocked(api.listReportSchedules).mockResolvedValue({
      items: [{ ...rule(), name: '他人更新的规则', row_version: 8 }],
      page: 1,
      size: 20,
      total: 1,
    })
    await button(wrapper, '刷新').trigger('click')
    await flushPromises()
    await button(wrapper, '编辑').trigger('click')
    await flushPromises()
    expect(dialog.findComponent(DtInput).props('modelValue')).toBe(
      '他人更新的规则',
    )
    expect(dialog.text()).not.toContain('规则已被其他人修改')
    vi.mocked(api.saveReportSchedule).mockResolvedValue({
      ...rule(),
      row_version: 9,
    })
    await button(wrapper, '保存规则').trigger('click')
    await flushPromises()
    expect(api.saveReportSchedule).toHaveBeenLastCalledWith(
      's1',
      expect.objectContaining({ name: '他人更新的规则', expected_version: 8 }),
    )
    expect(dialog.props('modelValue')).toBe(false)
  })

  it('模板目录缺失时仍可编辑原规则，不把模板替换为目录首项', async () => {
    vi.mocked(api.listReportChoices).mockResolvedValue([])
    const { wrapper, dialog } = await openEdit()
    expect(
      dialog
        .findAllComponents(DtInput)
        .find((item) => item.props('label') === '报告模板')
        ?.props('modelValue'),
    ).toContain('模板目录未提供')
    await setField(dialog, '期末延迟小时数', '0')
    await button(wrapper, '保存规则').trigger('click')
    await flushPromises()
    expect(api.saveReportSchedule).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ delay_hours: 0, granularity: 'quarter' }),
    )
  })

  it.each([
    { permissions: ['report:view'] },
    { permissions: ['report:view', 'report:manage'] },
  ])('权限 $permissions 不显示编辑或新建入口', async ({ permissions }) => {
    signIn(permissions)
    const wrapper = await open()
    expect(
      wrapper.findAllComponents(DtButton).map((item) => item.text()),
    ).not.toContain('编辑')
    expect(wrapper.text()).not.toContain('新建规则')
  })
})

describe('定时规则字段校验', () => {
  it.each(['', ' ', '-1', '721', '2.5', 'Infinity', 'NaN', '1e309', '0x10'])(
    '创建延迟 %j 被就地拒绝，不发请求',
    async (delay) => {
      const { wrapper, dialog } = await openCreate()
      await setField(dialog, '期末延迟小时数', delay)
      await button(wrapper, '创建规则').trigger('click')
      await flushPromises()
      expect(dialog.text()).toContain('0～720 的整数小时数')
      expect(api.createReportSchedule).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['   ', '规则名称不能为空'],
    ['字'.repeat(129), '最多 128 个字符'],
  ])('创建名称 %j 被就地拒绝', async (name, message) => {
    const { wrapper, dialog } = await openCreate()
    await setField(dialog, '规则名称', name)
    await button(wrapper, '创建规则').trigger('click')
    await flushPromises()
    expect(dialog.text()).toContain(message)
    expect(api.createReportSchedule).not.toHaveBeenCalled()
  })

  it.each(['0', '720'])(
    '创建接受延迟边界 %s 并去除名称首尾空白',
    async (delay) => {
      const { wrapper, dialog } = await openCreate()
      await setField(dialog, '规则名称', `  ${'😀'.repeat(128)}  `)
      await setField(dialog, '期末延迟小时数', delay)
      await button(wrapper, '创建规则').trigger('click')
      await flushPromises()
      expect(api.createReportSchedule).toHaveBeenCalledWith({
        template_id: 'r1',
        name: '😀'.repeat(128),
        delay_hours: Number(delay),
        granularity: 'month',
        is_enabled: true,
      })
    },
  )

  it('编辑也执行相同边界校验，纠正字段后可保存', async () => {
    const { wrapper, dialog } = await openEdit()
    await setField(dialog, '规则名称', '   ')
    await setField(dialog, '期末延迟小时数', '721')
    await button(wrapper, '保存规则').trigger('click')
    await flushPromises()
    expect(dialog.text()).toContain('规则名称不能为空')
    expect(dialog.text()).toContain('0～720 的整数小时数')
    expect(api.saveReportSchedule).not.toHaveBeenCalled()
    await setField(dialog, '规则名称', '恢复')
    await setField(dialog, '期末延迟小时数', '720')
    await button(wrapper, '保存规则').trigger('click')
    await flushPromises()
    expect(api.saveReportSchedule).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ name: '恢复', delay_hours: 720 }),
    )
  })
})
