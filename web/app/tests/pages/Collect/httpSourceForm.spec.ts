/** @fileoverview HTTP 数据源表单的真实 DOM、认证凭据与请求配置契约。 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { CollectSource } from '@dt/contracts'
import SourceFormDialog from '@/pages/Collect/Opcua/components/SourceFormDialog.vue'

enableAutoUnmount(afterEach)
beforeEach(() => {
  document.body.innerHTML = ''
})

async function render(
  source: CollectSource | null = null,
): Promise<VueWrapper> {
  const wrapper = mount(SourceFormDialog, {
    props: { modelValue: true, source },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  await flushPromises()
  return wrapper
}
async function choose(
  wrapper: VueWrapper,
  selector: string,
  label: string,
): Promise<void> {
  await wrapper.find(selector).trigger('click')
  await flushPromises()
  const option = [
    ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((node) => node.textContent?.trim() === label)
  if (option === undefined) throw new Error(`没有选项 ${label}`)
  option.click()
  await flushPromises()
}
async function press(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll('button').find((node) => node.text() === label)
  if (button === undefined) throw new Error(`没有按钮 ${label}`)
  await button.trigger('click')
  await flushPromises()
}
async function httpForm(): Promise<VueWrapper> {
  const wrapper = await render()
  await choose(wrapper, '[role="combobox"]', 'HTTP / HTTPS')
  await wrapper
    .find('input[placeholder="如：1号生产线 PLC"]')
    .setValue('HTTP 能源接口')
  await wrapper
    .find('input[placeholder="如：plant1_plc"]')
    .setValue('energy_http')
  await wrapper
    .find('input[placeholder="https://api.example.com/metrics"]')
    .setValue('https://api.example.com/metrics')
  return wrapper
}
function httpSource(): CollectSource {
  return {
    id: 's1',
    name: 'HTTP 能源接口',
    code: 'energy_http',
    description: null,
    protocol: 'http',
    endpoint: 'https://api.example.com/metrics',
    username: null,
    has_credential: true,
    options_json: { auth_type: 'bearer' },
    read_mode: 'poll',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 1,
    live_point_limit: 1000,
    runtime: {
      state: 'online',
      point_count: 1,
      error_category: null,
      error_detail: null,
      leader_instance: null,
      updated_at: null,
    },
    created_at: '2026-10-05T00:00:00Z',
    updated_at: '2026-10-05T00:00:00Z',
  }
}

describe('HTTP 请求配置', () => {
  it('协议可从真实下拉选中，固定轮询并提交 GET 默认配置', async () => {
    const wrapper = await httpForm()
    expect(wrapper.text()).toContain('认证方式')
    expect(wrapper.text()).toContain('轮询')
    expect(
      wrapper.find('textarea[aria-label="HTTP 请求头 JSON"]').exists(),
    ).toBe(true)
    await press(wrapper, '创建')
    expect(wrapper.emitted('create')?.[0]?.[0]).toMatchObject({
      protocol: 'http',
      read_mode: 'poll',
      endpoint: 'https://api.example.com/metrics',
      options_json: {
        auth_type: 'none',
        method: 'GET',
        timeout_s: '5',
        max_response_bytes: '1048576',
      },
    })
  })
  it('POST 请求体、字符串查询与请求头随配置提交', async () => {
    const wrapper = await httpForm()
    await choose(wrapper, '[aria-label="HTTP 请求方法"]', 'POST（查询接口）')
    await wrapper
      .find('textarea[aria-label="HTTP 请求头 JSON"]')
      .setValue('{"Accept":"application/json"}')
    await wrapper
      .find('textarea[aria-label="HTTP 查询参数 JSON"]')
      .setValue('{"device":"line1"}')
    await wrapper
      .find('textarea[aria-label="HTTP 请求体 JSON"]')
      .setValue('{"filter":{"site":"plant1"}}')
    await press(wrapper, '创建')
    expect(wrapper.emitted('create')?.[0]?.[0]).toMatchObject({
      options_json: {
        method: 'POST',
        body_json: '{"filter":{"site":"plant1"}}',
        query_json: '{"device":"line1"}',
      },
    })
  })
  it('非法 JSON 与普通请求头里的认证信息明确拒绝', async () => {
    const wrapper = await httpForm()
    const headers = wrapper.find('textarea[aria-label="HTTP 请求头 JSON"]')
    await headers.setValue('{')
    await press(wrapper, '创建')
    expect(wrapper.text()).toContain('请求头不是有效 JSON')
    await wrapper
      .find('textarea[aria-label="HTTP 请求头 JSON"]')
      .setValue('{"Authorization":"Bearer secret"}')
    await press(wrapper, '创建')
    expect(wrapper.text()).toContain('请使用认证配置')
    expect(wrapper.emitted('create')).toBeUndefined()
  })
})

describe('HTTP 认证', () => {
  it.each([
    ['Basic 用户名 / 密码', 'basic', true],
    ['Digest 用户名 / 密码', 'digest', true],
    ['Bearer Token', 'bearer', false],
    ['API Key（请求头）', 'api_key', false],
    ['OAuth 2.0 Client Credentials', 'oauth2_client_credentials', true],
  ])(
    '%s 使用独立密码框，秘密不出现在 options_json 中',
    async (label, authType, hasUsername) => {
      const wrapper = await httpForm()
      await choose(wrapper, '[aria-label="HTTP 认证方式"]', label)
      if (hasUsername)
        await wrapper
          .find(
            `input[placeholder="${authType === 'oauth2_client_credentials' ? 'OAuth Client ID' : 'HTTP 认证用户名'}"]`,
          )
          .setValue('client')
      if (authType === 'oauth2_client_credentials')
        await wrapper
          .find('input[placeholder="https://api.example.com/oauth/token"]')
          .setValue('https://api.example.com/oauth/token')
      const password = wrapper.find('input[type="password"]')
      expect(password.exists()).toBe(true)
      await password.setValue('secret-value')
      await press(wrapper, '创建')
      expect(wrapper.emitted('create')?.[0]?.[0]).toMatchObject({
        credential: 'secret-value',
        options_json: { auth_type: authType },
      })
      const payload: unknown = wrapper.emitted('create')?.[0]?.[0]
      if (typeof payload !== 'object' || payload === null)
        throw new Error('没有创建请求')
      expect(
        JSON.stringify(Reflect.get(payload, 'options_json')),
      ).not.toContain('secret-value')
    },
  )
  it('认证未填写凭据时不提交', async () => {
    const wrapper = await httpForm()
    await choose(wrapper, '[aria-label="HTTP 认证方式"]', 'Bearer Token')
    await press(wrapper, '创建')
    expect(wrapper.text()).toContain('请填写认证凭据')
    expect(wrapper.emitted('create')).toBeUndefined()
  })
  it('编辑留空保留凭据；切换匿名清空账号及旧凭据', async () => {
    const wrapper = await render(httpSource())
    expect(wrapper.find('input[type="password"]').element).toHaveProperty(
      'value',
      '',
    )
    await press(wrapper, '保存')
    expect(wrapper.emitted('update')?.[0]?.[0]).not.toHaveProperty('credential')
    await choose(wrapper, '[aria-label="HTTP 认证方式"]', '无认证')
    await press(wrapper, '保存')
    expect(wrapper.emitted('update')?.[1]?.[0]).toMatchObject({
      credential: null,
      username: null,
    })
  })
  it('API Key 可命名专用头，超时与响应限制可编辑', async () => {
    const wrapper = await httpForm()
    await choose(wrapper, '[aria-label="HTTP 认证方式"]', 'API Key（请求头）')
    await wrapper.find('input[placeholder="X-API-Key"]').setValue('X-Plant-Key')
    await wrapper.find('input[type="password"]').setValue('secret')
    const timeout = wrapper.find('input[aria-label="HTTP 请求超时（秒）"]')
    await timeout.setValue('7')
    await timeout.trigger('change')
    const limit = wrapper.find('input[aria-label="HTTP 响应上限（字节）"]')
    await limit.setValue('2048')
    await limit.trigger('change')
    await press(wrapper, '创建')
    expect(wrapper.emitted('create')?.[0]?.[0]).toMatchObject({
      options_json: {
        auth_header: 'X-Plant-Key',
        timeout_s: '7',
        max_response_bytes: '2048',
      },
    })
  })
  it('OAuth scope 与清空凭据开关生效，缺失凭据明确拒绝', async () => {
    const wrapper = await render({
      ...httpSource(),
      username: 'client',
      options_json: {
        auth_type: 'oauth2_client_credentials',
        token_endpoint: 'https://api.example.com/oauth/token',
      },
    })
    await wrapper
      .find('input[placeholder="如：read:metrics"]')
      .setValue('read:metrics')
    await press(wrapper, '保存')
    expect(wrapper.emitted('update')?.[0]?.[0]).toMatchObject({
      options_json: { scope: 'read:metrics' },
    })
    const clear = wrapper
      .findAll('[role="switch"]')
      .find((node) => node.text().includes('删掉已保存'))
    if (clear === undefined) throw new Error('没有清空凭据开关')
    await clear.trigger('click')
    await press(wrapper, '保存')
    expect(wrapper.text()).toContain('请填写认证凭据')
    expect(
      wrapper.find('input[type="password"]').attributes('disabled'),
    ).toBeDefined()
  })
  it('POST 改 GET 时移除旧请求体；切协议不携带另一种协议的连接选项', async () => {
    const wrapper = await httpForm()
    await choose(wrapper, '[aria-label="HTTP 请求方法"]', 'POST（查询接口）')
    await wrapper
      .find('textarea[aria-label="HTTP 请求体 JSON"]')
      .setValue('{"value":1}')
    await choose(wrapper, '[aria-label="HTTP 请求方法"]', 'GET')
    await press(wrapper, '创建')
    const payload: unknown = wrapper.emitted('create')?.[0]?.[0]
    if (typeof payload !== 'object' || payload === null)
      throw new Error('没有创建请求')
    expect(Reflect.get(payload, 'options_json')).not.toHaveProperty('body_json')
    await choose(wrapper, '[role="combobox"]', 'Modbus TCP（只读）')
    await wrapper
      .find('input[placeholder="modbus.tcp://host:502"]')
      .setValue('modbus.tcp://10.0.0.2:502')
    await press(wrapper, '创建')
    expect(wrapper.emitted('create')?.[1]?.[0]).toMatchObject({
      protocol: 'modbus_tcp',
      options_json: {},
    })
  })
})
