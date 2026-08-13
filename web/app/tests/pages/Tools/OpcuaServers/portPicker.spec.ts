/**
 * @fileoverview 建实例时的端口选择。
 *
 * ⚠ 端口只能从池里挑。池外的端口没有容器映射：服务 bind 得上，上位机连不上，
 * 而实例状态显示「运行中」——这是最难查的一类故障。所以这里给的是候选清单
 * 而不是一个自由输入框，池外取值后端也会以 42113 拒绝。
 *
 * ⚠ 被 42113 拒绝时页面**不许自作主张换一个端口重试**：那会把一个明确的
 * 拒绝变成沉默的错，用户以为自己拿到了 4841，实际跑在别处。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { OpcuaInstance, OpcuaPortPool } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as opcuaApi from '@/api/opcua'
import InstanceFormDialog from '@/pages/Tools/OpcuaServers/components/InstanceFormDialog.vue'
import OpcuaServersPage from '@/pages/Tools/OpcuaServers/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/tools/opcua-servers', params: {}, query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const errorToast = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: () => Promise.resolve(true) }),
    useToast: () => ({ success: vi.fn(), error: errorToast, info: vi.fn() }),
  }
})

function pool(over: Partial<OpcuaPortPool> = {}): OpcuaPortPool {
  return {
    total: 10,
    used: 2,
    available: 8,
    instance_count: 2,
    max_instances: 10,
    free_ports: [4842, 4843, 4844],
    ...over,
  }
}

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

/** 直接挂表单本体，省掉列表页那一层。 */
async function dialog(
  poolResult: OpcuaPortPool | Error = pool(),
  target: OpcuaInstance | null = null,
) {
  const spy = vi.spyOn(opcuaApi, 'getPortPool')
  if (poolResult instanceof Error) spy.mockRejectedValue(poolResult)
  else spy.mockResolvedValue(poolResult)
  const wrapper = mount(InstanceFormDialog, {
    props: { modelValue: true, instance: target },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

/** 弹窗内容进的是 body（teleport），按文字找按钮要从那里找。 */
function bodyButton(text: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text,
  )
}

function bodyText(): string {
  return document.body.textContent ?? ''
}

/** 点一个单选项。DtRadio 是 `role="radio"` 的 div，不是原生 input。 */
async function pickMode(label: string): Promise<void> {
  const radio = [...document.body.querySelectorAll('[role="radio"]')].find(
    (item) => item.textContent?.includes(label),
  )
  ;(radio as HTMLElement | undefined)?.click()
  await flushPromises()
}

/** 展开端口下拉，回它当前给出的候选。DtSelect 是 combobox + listbox。 */
async function portOptions(): Promise<(string | undefined)[]> {
  const trigger = [...document.body.querySelectorAll('[role="combobox"]')].at(
    -1,
  )
  ;(trigger as HTMLElement | undefined)?.click()
  await flushPromises()
  return [...document.body.querySelectorAll('[role="option"]')].map((option) =>
    option.textContent?.trim(),
  )
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  errorToast.mockReset()
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

describe('端口池的用量摆在明处', () => {
  it('说清池子多大、用了几个、还能选几个、实例上限多少', async () => {
    await dialog()
    const text = bodyText()
    expect(text).toContain('池内 10 个端口')
    expect(text).toContain('已用 2')
    expect(text).toContain('可选 8')
    expect(text).toContain('实例上限 10')
  })

  it('端口池取不到时如实说，而不是装作可以随便填', async () => {
    await dialog(new BizError(50000, '端口池服务不可用', 500, 't'))
    expect(bodyText()).toContain('取不到端口池')
    expect(bodyText()).toContain('端口池服务不可用')
  })

  it('⚠ 池子用尽时不给「指定端口」这个选项，并说明扩池是部署期的事', async () => {
    await dialog(pool({ free_ports: [], available: 0, used: 10 }))
    expect(bodyText()).toContain('端口池已用尽')
    expect(bodyText()).toContain('容器的端口段映射')
    expect(bodyText()).not.toContain('指定端口')
  })
})

describe('挑一个端口', () => {
  it('默认自动分配——多数人并不在意具体是哪个', async () => {
    const wrapper = await dialog()
    expect(bodyText()).toContain('自动分配')
    expect(document.body.querySelector('[role="combobox"]')).toBeNull()
    wrapper.unmount()
  })

  it('切到指定端口后只给池里的空闲端口，一个都不多', async () => {
    await dialog()
    await pickMode('指定端口')
    expect(await portOptions()).toEqual(['4842', '4843', '4844'])
  })

  it('⚠ 选项是候选清单不是自由输入——池外的端口根本敲不进来', async () => {
    await dialog()
    await pickMode('指定端口')
    expect(document.body.querySelector('input[aria-label="端口"]')).toBeNull()
    expect(document.body.querySelector('[role="combobox"]')).not.toBeNull()
  })
})

describe('创建时下发的入参', () => {
  async function fill(wrapper: Awaited<ReturnType<typeof dialog>>) {
    const inputs = [...document.body.querySelectorAll('input')].filter(
      (item) => item.type !== 'radio' && item.type !== 'checkbox',
    )
    for (const [index, value] of [
      [0, 'plant'],
      [3, 'urn:dt:plant'],
    ] as const) {
      const field = inputs[index]
      if (field === undefined) continue
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    return wrapper.emitted('create')?.[0]?.[0]
  }

  it('自动分配时不带 port 字段', async () => {
    const wrapper = await dialog()
    const input = await fill(wrapper)
    expect(input).toBeDefined()
    expect(Object.keys(input ?? {})).not.toContain('port')
  })

  it('指定端口时带上选中的那个，且是数字不是字符串', async () => {
    const wrapper = await dialog()
    await pickMode('指定端口')
    const input = await fill(wrapper)
    expect(input).toMatchObject({ port: 4842 })
  })

  it('编辑既有实例时压根不问端口——改端口等于换一个对方连不上的地址', async () => {
    const spy = vi.spyOn(opcuaApi, 'getPortPool').mockResolvedValue(pool())
    mount(InstanceFormDialog, {
      props: { modelValue: true, instance: instance() },
      attachTo: document.body,
    })
    await flushPromises()
    expect(spy).not.toHaveBeenCalled()
    expect(bodyText()).not.toContain('自动分配')
  })
})

describe('⚠ 42113 被拒绝时', () => {
  it('原样展示后端的话，绝不换个端口重试', async () => {
    vi.spyOn(opcuaApi, 'listInstances').mockResolvedValue({
      items: [],
      page: 1,
      size: 20,
      total: 0,
    })
    vi.spyOn(opcuaApi, 'getPortPool').mockResolvedValue(pool())
    const create = vi
      .spyOn(opcuaApi, 'createInstance')
      .mockRejectedValue(
        new BizError(42113, '端口 4842 已被占用', 409, 'trace-9'),
      )
    const wrapper = mount(OpcuaServersPage, {
      attachTo: document.body,
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '新建实例')
      ?.trigger('click')
    await flushPromises()
    await pickMode('指定端口')
    // ⚠ 只在弹窗里找输入框：列表页自己也有一个搜索框，从 body 全局取会串
    const modal = document.body.querySelector('.dt-modal')
    const inputs = [...(modal?.querySelectorAll('input') ?? [])].filter(
      (item) => item.type !== 'radio' && item.type !== 'checkbox',
    )
    for (const [index, value] of [
      [0, 'plant'],
      [3, 'urn:dt:plant'],
    ] as const) {
      const field = inputs[index]
      if (field === undefined) continue
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPromises()
    bodyButton('创建')?.click()
    await flushPromises()
    expect(errorToast).toHaveBeenCalledWith('端口 4842 已被占用')
    // 只发过一次：没有偷偷换个端口再试
    expect(create).toHaveBeenCalledTimes(1)
  })
})
