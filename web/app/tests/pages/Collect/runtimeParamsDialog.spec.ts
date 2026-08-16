/**
 * @fileoverview 采集/归档运行参数弹窗的行为契约。
 *
 * ⚠ 三条口径最要紧：
 * 1. 危险方向（关总开关、调小容量）要求原样输入确认词，安全方向不弹。
 * 2. 非即时档保存成功后要如实说「还没生效」。
 * 3. 只提交改过的项——整份回写会把别人刚改的项一起覆盖掉。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { RuntimeParamItem } from '@dt/contracts'

import * as runtimeApi from '@/api/runtimeParams'
import RuntimeParamsDialog from '@/pages/Collect/Opcua/components/RuntimeParamsDialog.vue'
import { useAuthStore } from '@/stores/auth'

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: vi.fn().mockResolvedValue(true) }),
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  }
})

function item(over: Partial<RuntimeParamItem> = {}): RuntimeParamItem {
  return {
    section: 'archive',
    key: 'enabled',
    envName: 'COLLECT_ARCHIVE_ENABLED',
    writeCode: 'collect:manage',
    label: '归档总开关',
    hint: '关掉之后完全没有报错。',
    kind: 'switch',
    unit: '',
    step: 1,
    minimum: 0,
    maximum: 1,
    tier: 'instant',
    danger: 'off',
    value: true,
    defaultValue: true,
    overridden: false,
    updatedBy: null,
    updatedAt: null,
    previousValue: null,
    ...over,
  }
}

function signIn(permissions: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: permissions,
    direct_permissions: [],
    permissions,
  } as never
  auth.accessToken = 'token'
}

async function render(rows: RuntimeParamItem[]): Promise<VueWrapper> {
  vi.spyOn(runtimeApi, 'listRuntimeParams').mockResolvedValue(rows)
  const wrapper = mount(RuntimeParamsDialog, {
    props: {
      modelValue: true,
      section: 'archive',
      title: '运行参数 · 点位历史归档',
      intro: '总开关在这里拨。',
    },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}

function fieldSwitch(wrapper: VueWrapper, key: string) {
  const found = wrapper.find(`[data-test="field-${key}"]`)
  if (!found.exists()) throw new Error(`没有 field-${key}`)
  return found
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  toastError.mockReset()
  toastSuccess.mockReset()
  document.body.innerHTML = ''
  signIn(['collect:view', 'collect:manage'])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('读与渲染', () => {
  it('打开就取当前分组，逐项带档位徽标与环境变量名', async () => {
    const wrapper = await render([
      item(),
      item({
        key: 'batch_rows',
        label: '单批行数',
        kind: 'int',
        unit: '行',
        minimum: 1,
        maximum: 5000,
        tier: 'instant',
        danger: null,
        value: 1000,
        defaultValue: 1000,
      }),
    ])
    expect(vi.mocked(runtimeApi.listRuntimeParams)).toHaveBeenCalledWith(
      'archive',
    )
    expect(wrapper.text()).toContain('归档总开关')
    expect(wrapper.text()).toContain('COLLECT_ARCHIVE_ENABLED')
    expect(wrapper.text()).toContain('即时生效')
  })

  it('已覆盖的项亮徽标并写清改动人与旧值', async () => {
    const wrapper = await render([
      item({ overridden: true, updatedBy: 'ops', previousValue: true }),
    ])
    expect(wrapper.text()).toContain('已覆盖')
    expect(wrapper.text()).toContain('ops')
  })
})

describe('危险方向确认', () => {
  it('⚠ 关总开关要求原样输入确认词，随手点不出去', async () => {
    const save = vi.spyOn(runtimeApi, 'saveRuntimeParams')
    const wrapper = await render([item()])

    await fieldSwitch(wrapper, 'enabled').trigger('click')
    await wrapper.find('[data-test="runtime-params-save"]').trigger('click')
    await flushPromises()

    // 没输确认词之前不许提交
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="danger-confirm"]').exists()).toBe(true)
    const okButton = wrapper.find('[data-test="danger-confirm-ok"]')
    expect(okButton.attributes('disabled')).toBeDefined()

    await wrapper
      .find('[data-test="danger-confirm-input"] input, input')
      .setValue('我已确认')
    await wrapper.find('[data-test="danger-confirm-ok"]').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith('archive', { enabled: false })
  })

  it('安全方向（由关改开）不弹确认，直接保存', async () => {
    const save = vi
      .spyOn(runtimeApi, 'saveRuntimeParams')
      .mockResolvedValue([item({ value: true })])
    const wrapper = await render([item({ value: false })])

    await fieldSwitch(wrapper, 'enabled').trigger('click')
    await wrapper.find('[data-test="runtime-params-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="danger-confirm"]').exists()).toBe(false)
    expect(save).toHaveBeenCalledWith('archive', { enabled: true })
  })
})

describe('生效档位提示', () => {
  it('⚠ 改了下次重连档的项，保存后要说「还没生效」', async () => {
    // 用开关型编一个重连档项：数字控件在 happy-dom 里摸不到内层 input，
    // 而这条口径考的是「档位提示」，不是控件本身
    const reconnect = item({
      section: 'collect',
      key: 'fast_probe',
      label: '快速探测',
      tier: 'reconnect',
      danger: null,
      value: false,
      defaultValue: false,
    })
    vi.spyOn(runtimeApi, 'saveRuntimeParams').mockResolvedValue([
      { ...reconnect, value: true, overridden: true },
    ])
    const wrapper = await render([reconnect])

    await fieldSwitch(wrapper, 'fast_probe').trigger('click')
    await wrapper.find('[data-test="runtime-params-save"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-test="reconnect-notice"]').exists()).toBe(true)
  })
})

describe('权限', () => {
  it('只读账号看得到取值，但没有保存与恢复默认', async () => {
    signIn(['collect:view'])
    const wrapper = await render([item()])
    expect(wrapper.find('[data-test="runtime-params-save"]').exists()).toBe(
      false,
    )
    expect(wrapper.text()).not.toContain('恢复默认')
  })
})
