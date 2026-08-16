/**
 * @fileoverview 数据源表单的行为契约。
 *
 * ⚠ 三条口径最要紧：
 * 1. 安全模式/安全策略写进 `options_json` 的两个固定键，且不覆盖其余连接参数。
 * 2. 口令三态：不填=不带字段、填了=改、勾清空=显式 null。
 * 3. 编辑态不许改编码——它是身份，改了历史断成两段。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type {
  CollectSource,
  CollectSourceCreateInput,
  CollectSourceUpdateInput,
} from '@dt/contracts'

import SourceFormDialog from '@/pages/Collect/Opcua/components/SourceFormDialog.vue'

function source(): CollectSource {
  return {
    id: 's1',
    name: '一号车间 PLC',
    code: 'plant1',
    description: '车间主 PLC',
    protocol: 'opcua',
    endpoint: 'opc.tcp://10.0.0.2:4840',
    username: 'operator',
    has_credential: true,
    options_json: {
      security_mode: 'Sign',
      security_policy: 'Basic256Sha256',
      cert_path: '/etc/certs/plc.pem',
    },
    read_mode: 'subscribe',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 0,
    live_point_limit: 1000,
    runtime: {
      state: 'online',
      point_count: 0,
      error_category: null,
      error_detail: null,
      leader_instance: 'c1',
      updated_at: null,
    },
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

async function render(target: CollectSource | null): Promise<VueWrapper> {
  const wrapper = mount(SourceFormDialog, {
    props: { modelValue: true, source: target },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}

async function fill(
  wrapper: VueWrapper,
  placeholder: string,
  value: string,
): Promise<void> {
  const input = wrapper
    .findAll('input')
    .find((one) => one.attributes('placeholder')?.includes(placeholder))
  if (input === undefined)
    throw new Error(`没有占位符「${placeholder}」的输入框`)
  await input.setValue(value)
}

async function submit(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('button').find((one) => one.text() === label)
  if (button === undefined) throw new Error(`没有按钮「${label}」`)
  await button.trigger('click')
  await flushPromises()
}

function createdPayload(wrapper: VueWrapper): CollectSourceCreateInput {
  const emitted = wrapper.emitted('create')
  if (emitted === undefined) throw new Error('没有抛出 create')
  return emitted[0]?.[0] as CollectSourceCreateInput
}

function updatedPayload(wrapper: VueWrapper): CollectSourceUpdateInput {
  const emitted = wrapper.emitted('update')
  if (emitted === undefined) throw new Error('没有抛出 update')
  return emitted[0]?.[0] as CollectSourceUpdateInput
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('新建', () => {
  it('固定 opcua 协议，安全两键并进 options_json', async () => {
    const wrapper = await render(null)
    await fill(wrapper, '1号生产线', '二号线')
    await fill(wrapper, 'opc.tcp://host:4840', 'opc.tcp://10.0.0.9:4840')
    await fill(wrapper, 'plant1_plc', 'line2')
    await submit(wrapper, '创建')

    const payload = createdPayload(wrapper)
    expect(payload.protocol).toBe('opcua')
    expect(payload.code).toBe('line2')
    expect(payload.options_json).toEqual({
      security_mode: 'None',
      security_policy: 'None',
    })
    // 没填的可选项不带字段，而不是发一个空串
    expect(payload.credential).toBeUndefined()
    expect(payload.username).toBeUndefined()
  })

  it('⚠ 编码不合法时拦下来，不发一个后端注定 422 的请求', async () => {
    const wrapper = await render(null)
    await fill(wrapper, '1号生产线', '二号线')
    await fill(wrapper, 'opc.tcp://host:4840', 'opc.tcp://10.0.0.9:4840')
    await fill(wrapper, 'plant1_plc', '中文编码')
    await submit(wrapper, '创建')

    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.text()).toContain('编码只能用')
  })
})

describe('编辑', () => {
  it('回填安全两键与其余连接参数各归各位，编码只读', async () => {
    const wrapper = await render(source())
    const code = wrapper
      .findAll('input')
      .find((one) => one.attributes('placeholder')?.includes('plant1_plc'))
    expect(code?.attributes('disabled')).toBeDefined()

    await submit(wrapper, '保存')
    const payload = updatedPayload(wrapper)
    // ⚠ 其余连接参数（cert_path）不许被安全两键的写入顶掉
    expect(payload.options_json).toEqual({
      security_mode: 'Sign',
      security_policy: 'Basic256Sha256',
      cert_path: '/etc/certs/plc.pem',
    })
    expect(payload.username).toBe('operator')
    expect(payload.description).toBe('车间主 PLC')
    // 没动口令就不带 credential 字段
    expect('credential' in payload).toBe(false)
  })

  it('⚠ 勾「清空密码」发显式 null——与「不动」必须分得开', async () => {
    const wrapper = await render(source())
    // 「清空密码」是表单里唯一带可见 label 的开关（启用开关走 aria-label）
    const clear = wrapper
      .findAll('[role="switch"]')
      .find((one) => one.attributes('aria-label') === undefined)
    if (clear === undefined) throw new Error('没有「清空密码」开关')
    await clear.trigger('click')
    await submit(wrapper, '保存')

    expect(updatedPayload(wrapper).credential).toBeNull()
  })

  it('填了新口令就带上它', async () => {
    const wrapper = await render(source())
    await fill(wrapper, '留空表示不修改', 'new-secret')
    await submit(wrapper, '保存')

    expect(updatedPayload(wrapper).credential).toBe('new-secret')
  })
})
