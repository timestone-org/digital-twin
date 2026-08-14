/**
 * @fileoverview 新建接入凭据时那一次性的明文口令。
 *
 * ⚠ 口令只在创建回执里回一次，之后任何接口都取不到。所以它必须当场、显眼地
 * 摆出来，并说清关掉就没了——做成一条会自己消失的 toast，用户就失去了唯一
 * 一次抄走的机会，只能删了重建。一键复制是为了少一次抄错。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { OpcuaInstance } from '@dt/contracts'

import * as opcuaApi from '@/api/opcua'
import SecurityPanel from '@/pages/Tools/OpcuaServerDetail/components/SecurityPanel.vue'
import { useAuthStore } from '@/stores/auth'

const successToast = vi.fn()
const errorToast = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: () => Promise.resolve(true) }),
    useToast: () => ({
      success: successToast,
      error: errorToast,
      info: vi.fn(),
    }),
  }
})

const copySpy = vi.fn<(text: string) => Promise<boolean>>()
vi.mock('@/utils/clipboard', () => ({
  copyText: (text: string) => copySpy(text),
}))

function instance(over: Partial<OpcuaInstance> = {}): OpcuaInstance {
  return {
    id: 'i1',
    name: 'plant',
    description: null,
    endpoint_path: '/dt',
    endpoint_url: 'opc.tcp://h:4840/dt',
    port: 4840,
    namespace_uri: 'urn:dt',
    security_policies: ['NoSecurity'],
    is_anonymous_allowed: false,
    is_autostart: false,
    desired_state: 'stopped',
    is_running: false,
    has_pending_restart: false,
    pending_fields: [],
    certificate: { fingerprint: null, subject: null, expires_at: null },
    node_count: 0,
    session_count: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

function bodyButton(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  )
}

/** 走一遍「新建凭据 → 拿到一次性口令」。 */
async function issue() {
  vi.spyOn(opcuaApi, 'listCredentials').mockResolvedValue([])
  vi.spyOn(opcuaApi, 'listTrustedCertificates').mockResolvedValue([])
  vi.spyOn(opcuaApi, 'createCredential').mockResolvedValue({
    credential: {
      id: 'c1',
      instance_id: 'i1',
      username: 'scada-01',
      created_at: '2026-08-01T00:00:00.000Z',
    },
    password: 'S3cret-once',
  })
  const wrapper = mount(SecurityPanel, {
    props: { instance: instance() },
    attachTo: document.body,
  })
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '新建凭据')
    ?.trigger('click')
  await flushPromises()
  const field = document.body.querySelector('input')
  if (field !== null) {
    field.value = 'scada-01'
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await flushPromises()
  bodyButton('创建')?.click()
  await flushPromises()
  return wrapper
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  successToast.mockReset()
  errorToast.mockReset()
  copySpy.mockReset().mockResolvedValue(true)
  const codes = ['opcua:view', 'opcua:operate', 'opcua:manage']
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  } as never
  auth.accessToken = 'token'
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('一次性口令', () => {
  it('⚠ 用独立弹窗当场摆出来，而不是一条会自己消失的 toast', async () => {
    await issue()
    const text = document.body.textContent ?? ''
    expect(text).toContain('口令只显示这一次')
    expect(text).toContain('S3cret-once')
    expect(text).toContain('scada-01')
  })

  it('说清关掉之后任何接口都取不回来，只能删了重建', async () => {
    await issue()
    const text = document.body.textContent ?? ''
    expect(text).toContain('任何接口都取不到')
    expect(text).toContain('删掉凭据重建')
  })

  it('一键复制的是口令本身，不是用户名', async () => {
    await issue()
    const copy = [...document.body.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === '复制口令',
    )
    copy?.click()
    await flushPromises()
    expect(copySpy).toHaveBeenCalledWith('S3cret-once')
    expect(successToast).toHaveBeenCalledWith('口令已复制')
  })

  it('复制不了时提示手动选中——绝不谎报已复制，那会让人直接关掉窗口', async () => {
    copySpy.mockResolvedValue(false)
    await issue()
    const copy = [...document.body.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === '复制口令',
    )
    copy?.click()
    await flushPromises()
    expect(errorToast).toHaveBeenCalledWith(expect.stringContaining('手动选中'))
  })

  it('抄走之后关掉，口令不再留在页面上', async () => {
    await issue()
    bodyButton('我已抄走')?.click()
    await flushPromises()
    expect(document.body.textContent ?? '').not.toContain('S3cret-once')
  })
})
