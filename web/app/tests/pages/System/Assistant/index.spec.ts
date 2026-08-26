/**
 * @fileoverview 助手模型页的行为契约。
 *
 * ⚠ 两条最要紧：页面上**永远不出现令牌**（后端也不回，账号只以掩码露面），
 * 以及退出登录必须二次确认——那一份凭据是整套部署共用的，退的是所有人的。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { DtConfirmHost, useConfirm } from '@dt/ui'

import * as assistant from '@/api/assistant'
import AssistantModelsPage from '@/pages/System/Assistant/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/system/assistant', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const MANAGE = 'assistant:manage'

function user(codes: string[]) {
  return {
    id: 'u1',
    username: 'admin',
    email: 'a@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    direct_permission_count: 0,
    permissions: codes,
    role_permissions: codes,
  } as never
}

function capability(models: unknown[]) {
  return {
    is_model_enabled: models.length > 0,
    is_vision_enabled: false,
    skills: [],
    models,
    default_model_id: 'default',
  } as never
}

function profile(over: Record<string, unknown> = {}) {
  return {
    id: 'default',
    label: '按量计费端点',
    is_ready: true,
    has_vision: true,
    models: ['qwen3.8-max'],
    efforts: [],
    ...over,
  }
}

const CODEX = profile({
  id: 'codex',
  label: '订阅账号',
  is_ready: false,
  has_vision: false,
  models: ['some-codex'],
  efforts: ['low', 'medium'],
})

function statusOf(over: Record<string, unknown> = {}) {
  return {
    provider: 'codex',
    is_connected: true,
    account_label: '…a1b2c3',
    plan_label: 'plus',
    expires_at: '2026-08-27T00:00:00.000Z',
    last_refresh_at: null,
    last_error: null,
    ...over,
  } as never
}

beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = user([MANAGE])
  auth.accessToken = 'token'
  vi.spyOn(assistant, 'probeCapability').mockResolvedValue(
    capability([profile(), CODEX]),
  )
  vi.spyOn(assistant, 'readCredential').mockResolvedValue(null)
})

enableAutoUnmount(afterEach)

afterEach(() => {
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

async function render() {
  const wrapper = mount(AssistantModelsPage)
  await flushPromises()
  return wrapper
}

/** 点页面里那个按钮。⚠ VTU 默认挂在游离节点上，`document` 里找不到它。 */
async function click(
  wrapper: ReturnType<typeof mount>,
  text: string,
): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find((node) => node.text().includes(text))
  await button?.trigger('click')
  await flushPromises()
}

/** 点二次确认框里那个按钮。它 teleport 到 body，只能从 document 里找。 */
async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  button?.click()
  await flushPromises()
}

describe('助手模型页', () => {
  it('把接了的每一路都列出来，并标出哪一路还没登录', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('按量计费端点')
    expect(wrapper.text()).toContain('订阅账号')
    // 配了却没登录时摆成可用的话，用户点下去收到的是一条「模型暂时不可用」
    expect(wrapper.text()).toContain('未登录')
  })

  it('一路都没接时如实说，不摆一个空清单', async () => {
    vi.spyOn(assistant, 'probeCapability').mockResolvedValue(capability([]))
    const wrapper = await render()
    expect(wrapper.text()).toContain('一路模型都没接')
  })

  it('登录之后只露账号掩码，不露令牌', async () => {
    vi.spyOn(assistant, 'readCredential').mockResolvedValue(statusOf())
    const wrapper = await render()
    expect(wrapper.text()).toContain('…a1b2c3')
    expect(wrapper.text()).toContain('plus')
  })

  it('续期失败过就把原因说出来，并让人重新登录一次', async () => {
    vi.spyOn(assistant, 'readCredential').mockResolvedValue(
      statusOf({ last_error: 'refresh_token 已作废' }),
    )
    const wrapper = await render()
    expect(wrapper.text()).toContain('refresh_token 已作废')
    expect(wrapper.text()).toContain('换一个账号')
  })

  it('点登录就要来一次设备码，并把用户码摆出来', async () => {
    const start = vi.spyOn(assistant, 'startDeviceLogin').mockResolvedValue({
      ref: 'r1',
      user_code: 'ABCD-1234',
      verification_uri: 'https://example.test/activate',
      interval_s: 5,
      expires_in_s: 900,
    })
    const wrapper = await render()
    await click(wrapper, '登录账号')
    expect(start).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('ABCD-1234')
  })

  it('退出登录要二次确认——退的是所有人的', async () => {
    vi.spyOn(assistant, 'readCredential').mockResolvedValue(statusOf())
    const forget = vi
      .spyOn(assistant, 'forgetCredential')
      .mockResolvedValue(undefined)
    const wrapper = await render()
    mount(DtConfirmHost)
    await flushPromises()

    await click(wrapper, '退出登录')
    expect(forget).not.toHaveBeenCalled()
    // 确认框里的那个按钮才算数
    await clickInConfirm('退出登录')
    expect(forget).toHaveBeenCalledOnce()
  })

  it('开头就失败时把话说出来', async () => {
    vi.spyOn(assistant, 'startDeviceLogin').mockRejectedValue(
      new Error('登录服务此刻连不上'),
    )
    const wrapper = await render()
    await click(wrapper, '登录账号')
    expect(wrapper.text()).toContain('登录服务此刻连不上')
  })

  it('没有 assistant:manage 的人看不到这一页的内容', async () => {
    const auth = useAuthStore()
    auth.user = user([])
    const wrapper = await render()
    expect(wrapper.text()).not.toContain('按量计费端点')
  })
})
