/**
 * @fileoverview API 密钥管理页的行为契约。
 *
 * ⚠ 两条最要紧：明文**只在签发弹窗里出现一次**（列表任何时候都不该有它），
 * 以及吊销必须二次确认（它会让对方的系统当场收到 401）。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import * as admin from '@/api/admin'
import * as apiKeys from '@/api/apiKeys'
import ApiKeysPage from '@/pages/System/ApiKeys/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/system/api-keys', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const SECRET = 'dtk_a1b2c3d4_head_middle_tail'

/** 密钥假件。⚠ 形状照后端 `ApiKeyOut`——**没有明文字段**。 */
function key(over: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    user_id: 'u1',
    name: 'XX系统写点位',
    prefix: 'a1b2c3d4',
    is_active: true,
    expires_at: null,
    last_used_at: null,
    revoked_at: null,
    created_at: '2026-08-14T00:00:00.000Z',
    ...over,
  } as never
}

function listItem(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    username: 'svc-third-party',
    email: 'svc@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    role: { id: 'r1', name: 'viewer', description: null, is_builtin: true },
    direct_permission_count: 0,
    ...over,
  } as never
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = listItem({ permissions: codes, role_permissions: codes })
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 视图模式落在 localStorage 里，不清会跨用例串
  localStorage.clear()
  vi.spyOn(admin, 'listUsers').mockResolvedValue({
    items: [listItem()],
    page: 1,
    size: 200,
    total: 1,
  })
  vi.spyOn(apiKeys, 'listApiKeys').mockResolvedValue({
    items: [key()],
    page: 1,
    size: 20,
    total: 1,
  })
})

// 宿主 teleport 到 body，不自动卸载会撞上已被摘掉的容器
enableAutoUnmount(afterEach)

afterEach(() => {
  useToast().clear()
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

async function render(codes: string[]) {
  signIn(codes)
  const wrapper = mount(ApiKeysPage)
  await flushPromises()
  return wrapper
}

async function renderWithHosts(codes: string[]) {
  const wrapper = await render(codes)
  mount(DtConfirmHost)
  mount(DtToastHost)
  await flushPromises()
  return wrapper
}

async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  button?.click()
  await flushPromises()
}

describe('API 密钥页', () => {
  it('列出用途、前缀与归属账号', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('XX系统写点位')
    expect(wrapper.text()).toContain('a1b2c3d4')
    // user_id 是 UUID，光看它认不出这是哪个系统的钥匙
    expect(wrapper.text()).toContain('svc-third-party')
  })

  it('列表里只有前缀，没有完整明文', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).not.toContain(SECRET)
  })

  it('从未使用与永不过期各有明确文案，不是空白', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('从未使用')
    expect(wrapper.text()).toContain('永不过期')
  })

  it('已吊销与已过期分开显示——处置方式不同', async () => {
    vi.spyOn(apiKeys, 'listApiKeys').mockResolvedValue({
      items: [
        key({
          id: 'k-revoked',
          revoked_at: '2026-08-01T00:00:00.000Z',
          is_active: false,
        }),
        key({
          id: 'k-expired',
          expires_at: '2026-08-01T00:00:00.000Z',
          is_active: false,
        }),
      ],
      page: 1,
      size: 20,
      total: 2,
    })
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('已吊销')
    expect(wrapper.text()).toContain('已过期')
  })

  it('只读账号看不到签发与吊销入口', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).not.toContain('签发密钥')
    expect(wrapper.find('[aria-label="吊销"]').exists()).toBe(false)
  })

  it('持 user:manage 才出现签发与吊销', async () => {
    const wrapper = await render(['user:view', 'user:manage'])
    expect(wrapper.text()).toContain('签发密钥')
    expect(wrapper.find('[aria-label="吊销"]').exists()).toBe(true)
  })

  it('已吊销的行不再给吊销按钮', async () => {
    vi.spyOn(apiKeys, 'listApiKeys').mockResolvedValue({
      items: [
        key({ revoked_at: '2026-08-01T00:00:00.000Z', is_active: false }),
      ],
      page: 1,
      size: 20,
      total: 1,
    })
    const wrapper = await render(['user:view', 'user:manage'])
    expect(wrapper.find('[aria-label="吊销"]').exists()).toBe(false)
  })

  it('吊销要二次确认，取消则什么都不做', async () => {
    const revoke = vi.spyOn(apiKeys, 'revokeApiKey')
    const wrapper = await renderWithHosts(['user:view', 'user:manage'])
    await wrapper.find('[aria-label="吊销"]').trigger('click')
    await flushPromises()
    await clickInConfirm('取消')
    expect(revoke).not.toHaveBeenCalled()
  })

  it('确认后吊销并刷新列表', async () => {
    const revoke = vi
      .spyOn(apiKeys, 'revokeApiKey')
      .mockResolvedValue(key({ revoked_at: '2026-08-14T01:00:00.000Z' }))
    const wrapper = await renderWithHosts(['user:view', 'user:manage'])
    await wrapper.find('[aria-label="吊销"]').trigger('click')
    await flushPromises()
    await clickInConfirm('吊销')
    expect(revoke).toHaveBeenCalledWith('k1')
    // 第一次是挂载时，第二次是吊销后的刷新
    expect(vi.mocked(apiKeys.listApiKeys).mock.calls.length).toBeGreaterThan(1)
  })

  it('默认不带 should_include_revoked——已吊销的行会一直堆着', async () => {
    await render(['user:view'])
    const [firstCall] = vi.mocked(apiKeys.listApiKeys).mock.calls
    expect(firstCall?.[0]?.should_include_revoked).toBeUndefined()
  })
})
