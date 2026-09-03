/**
 * @fileoverview 模型服务页：明文只摆一次、停用与版本不可用要分得开、
 * 删服务之前要说清爆炸半径。
 *
 * ⚠ 这一组盯的是那几处「静默就出事」的地方：明文用 toast 摆会自己消失，
 * 而那是唯一一次看得到它的机会（docs/MODELING_PLATFORM_DESIGN.md D13）。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import type {
  ModelApiKey,
  ModelApiKeyMinted,
  ModelDeployment,
  ModelingVersionSummary,
} from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import ServicesPage from '@/pages/Modeling/Services/index.vue'
import { useAuthStore } from '@/stores/auth'

const STAMP = '2026-01-01T00:00:00.000Z'
const PLAINTEXT = 'dtmk_this-is-the-only-time-you-see-it'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/modeling/services', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function deployment(over: Partial<ModelDeployment> = {}): ModelDeployment {
  return {
    id: 'd1',
    code: 'energy-forecast',
    model_version_id: 'v1',
    model_name: '能耗回归',
    model_version: 3,
    name: '能耗预测服务',
    description: null,
    is_enabled: true,
    is_servable: true,
    unservable_reason: null,
    max_rows_per_call: 200,
    rate_limit_per_minute: 60,
    key_count: 1,
    created_by_name: '张三',
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function apiKey(over: Partial<ModelApiKey> = {}): ModelApiKey {
  return {
    id: 'k1',
    deployment_id: 'd1',
    name: 'MES 生产系统',
    key_prefix: 'dtmk_abc123',
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    created_by_name: '张三',
    created_at: STAMP,
    ...over,
  }
}

function minted(): ModelApiKeyMinted {
  return { ...apiKey(), plaintext: PLAINTEXT }
}

function signIn(permissions: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'u',
    permissions,
    role_permissions: permissions,
    direct_permissions: [],
    role: { name: 'r', description: '' },
  } as never
  auth.accessToken = 'token'
}

function stub(rows: ModelDeployment[], keys: ModelApiKey[] = []): void {
  vi.spyOn(modeling, 'listModelDeployments').mockResolvedValue(rows)
  vi.spyOn(modeling, 'listModelApiKeys').mockResolvedValue(keys)
  vi.spyOn(modeling, 'listModelCallStats').mockResolvedValue([])
  vi.spyOn(modeling, 'listModelingVersions').mockResolvedValue({
    items: [] as ModelingVersionSummary[],
    page: 1,
    size: 200,
    total: 0,
  })
}

function open() {
  return mount(ServicesPage, {
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('模型服务', () => {
  it('停用与「版本不可用」是两回事，各说各的', async () => {
    stub([
      deployment({ is_enabled: false }),
      deployment({
        id: 'd2',
        code: 'other',
        is_servable: false,
        unservable_reason: '模型产物已经不在存储里了',
      }),
    ])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('已停用')
    expect(wrapper.text()).toContain('不在存储里')
  })

  it('配额两档都摆出来，用户不必去猜', async () => {
    stub([deployment({ rate_limit_per_minute: 120, max_rows_per_call: 500 })])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('120 次/分')
    expect(wrapper.text()).toContain('500 行/次')
  })

  it('密钥列表里只有前缀，一个明文都没有', async () => {
    stub([deployment()], [apiKey()])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()
    await wrapper.findAll('button').find((item) => item.text() === '密钥')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('dtmk_abc123')
    expect(wrapper.text()).not.toContain(PLAINTEXT)
  })

  it('调用地址摆在密钥面上，不必去翻文档', async () => {
    stub([deployment()], [apiKey()])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()
    await wrapper.findAll('button').find((item) => item.text() === '密钥')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(
      '/api/v1/platform/open-models/energy-forecast:predict',
    )
  })

  it('铸出来那把钥匙的明文摆在一个要显式关掉的窗口里', async () => {
    stub([deployment()], [apiKey()])
    vi.spyOn(modeling, 'createModelApiKey').mockResolvedValue(minted())
    signIn([
      PERMISSION_CODES.modelingView,
      PERMISSION_CODES.modelingPublish,
    ])

    const wrapper = open()
    await flushPromises()
    await wrapper.findAll('button').find((item) => item.text() === '密钥')
      ?.trigger('click')
    await flushPromises()
    const input = wrapper.findAll('input')
    await input[input.length - 1]?.setValue('新对接方')
    await wrapper.findAll('button').find((item) => item.text() === '铸一把')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain(PLAINTEXT)
    expect(wrapper.text()).toContain('再也取不回')
  })

  it('只读账号看不到开通与撤销的入口', async () => {
    stub([deployment()], [apiKey()])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    const labels = wrapper.findAll('button').map((item) => item.text())
    expect(labels).not.toContain('开一个服务')
  })

  it('还没开出服务时说清楚下一步去哪儿', async () => {
    stub([])
    signIn([PERMISSION_CODES.modelingView])

    const wrapper = open()
    await flushPromises()

    expect(wrapper.text()).toContain('还没有开出对外服务')
    expect(wrapper.text()).toContain('模型库')
  })
})
