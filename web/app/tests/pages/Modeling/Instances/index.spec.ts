/** @fileoverview 历史实例批量操作的真实组件与 HTTP 边界。 */
import type { ModelingInstance } from '@dt/contracts'
import * as ui from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Instances from '@/pages/Modeling/Instances/index.vue'
import { useAuthStore } from '@/stores/auth'
import { configuration, run } from '@/testing/modelingTemplateFixtures'

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
}))

interface RecordedRequest {
  path: string
  url: string
  method: string
  body: unknown
  headers: Headers
}
const stamp = '2026-11-04T00:00:00.000Z'
const wrappers: VueWrapper[] = []
const requests: RecordedRequest[] = []
let rows: ModelingInstance[] = []
let onWrite: ((request: RecordedRequest) => Response) | undefined
let onList: ((url: URL) => Response) | undefined
let ask = vi.fn().mockResolvedValue(true)

function instance(id: string, overrides: Partial<ModelingInstance> = {}) {
  if (!configuration.instance) throw new Error('缺少实例夹具')
  return {
    ...configuration.instance,
    id,
    name: id,
    code: id,
    latest_run: null,
    ...overrides,
  } satisfies ModelingInstance
}
function response(data: unknown, status = 200, message = 'ok'): Response {
  return Response.json(
    { code: status < 400 ? 0 : 41432, message, data, trace_id: 'test-trace' },
    { status },
  )
}
function signIn(permissions = ['modeling:view', 'modeling:run']): void {
  useAuthStore().user = {
    id: 'u1',
    username: 'operator',
    email: '',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: stamp,
    updated_at: stamp,
    role: { id: 'r1', name: 'reader', description: null, is_builtin: false },
    permissions,
    role_permissions: permissions,
    direct_permissions: [],
  }
}
function writes() {
  return requests.filter((request) => request.method !== 'GET')
}
function button(wrapper: VueWrapper, label: string) {
  const found = wrapper
    .findAll('button')
    .find((item) => item.text().trim() === label)
  if (!found) throw new Error(`没有按钮：${label}`)
  return found
}
async function open(permissions?: string[]) {
  signIn(permissions)
  const wrapper = mount(Instances, {
    attachTo: document.body,
    global: {
      stubs: {
        AppShell: {
          template: '<section><slot name="actions" /><slot /></section>',
        },
        teleport: true,
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
async function selectAll(wrapper: VueWrapper) {
  await wrapper.get('input[aria-label="选择本页"]').setValue(true)
}
async function filter(wrapper: VueWrapper, value: string) {
  const field = wrapper
    .findAllComponents(ui.DtSelect)
    .find((item) => item.props('label') === '归档状态')
  if (!field) throw new Error('没有归档筛选')
  field.vm.$emit('update:modelValue', value)
  await flushPromises()
}

function listResponse(url: URL): Response {
  const archived = url.searchParams.get('archived') ?? 'active'
  const items = rows.filter(
    (row) =>
      archived === 'all' ||
      Boolean(row.archived_at) === (archived === 'archived'),
  )
  return response({
    items,
    page: Number(url.searchParams.get('page') ?? 1),
    size: Number(url.searchParams.get('size') ?? 20),
    total: 41,
  })
}

function handleRequest(
  input: Parameters<typeof fetch>[0],
  options?: RequestInit,
): Response {
  const url = new URL(
    input instanceof Request ? input.url : input.toString(),
    'http://test',
  )
  const body: unknown =
    typeof options?.body === 'string' ? JSON.parse(options.body) : null
  const request = {
    path: url.pathname,
    url: url.href,
    method: options?.method ?? 'GET',
    body,
    headers: new Headers(options?.headers),
  }
  requests.push(request)
  return reply(request, url)
}

function reply(request: RecordedRequest, url: URL): Response {
  if (request.method === 'GET') return onList?.(url) ?? listResponse(url)
  return onWrite?.(request) ?? response(run, 202)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  rows = [instance('实例甲'), instance('实例乙')]
  requests.length = 0
  onWrite = undefined
  onList = undefined
  ask = vi.fn().mockResolvedValue(true)
  vi.spyOn(ui, 'useConfirm').mockReturnValue({ ...ui.useConfirm(), ask })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>((input, options) =>
      Promise.resolve(handleRequest(input, options)),
    ),
  )
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each([['modeling:view'], ['modeling:view', 'modeling:publish']])(
  '缺少训练权限不提供批量选择与操作：%s',
  async (...permissions) => {
    const wrapper = await open(permissions)
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('批量提交训练')
    expect(wrapper.text()).not.toContain('批量归档实例')
  },
)

it('确认一次并逐项提交训练，跳过归档与正在训练的实例', async () => {
  rows = [
    instance('可训练'),
    instance('已归档', { archived_at: stamp }),
    instance('执行中', { latest_run: { ...run, status: 'running' } }),
  ]
  const wrapper = await open()
  await filter(wrapper, 'all')
  await selectAll(wrapper)
  await button(wrapper, '批量提交训练').trigger('click')
  await flushPromises()
  expect(ask).toHaveBeenCalledTimes(1)
  expect(writes().map((request) => decodeURIComponent(request.path))).toEqual([
    '/api/v1/platform/modeling-instances/可训练:train',
  ])
  expect(writes()[0]?.body).toEqual({ trigger: 'manual' })
  expect(writes()[0]?.headers.get('Idempotency-Key')).toBeTruthy()
  expect(wrapper.text()).toContain('训练提交成功不代表训练完成')
  expect(wrapper.text()).toContain('实例已归档')
  expect(wrapper.text()).toContain('已有训练正在进行')
})

it('批量归档与恢复分别带行修订号并保留名称和语义', async () => {
  rows = [instance('实例甲', { revision: 7 })]
  onWrite = (request) => {
    rows = [
      instance('实例甲', {
        revision: 8,
        archived_at: request.path.endsWith(':archive') ? stamp : null,
      }),
    ]
    return response(rows[0])
  }
  const wrapper = await open()
  await selectAll(wrapper)
  await button(wrapper, '批量归档实例').trigger('click')
  await flushPromises()
  expect(writes()[0]?.body).toEqual({ expected_revision: 7 })
  await filter(wrapper, 'archived')
  await selectAll(wrapper)
  await button(wrapper, '批量恢复实例').trigger('click')
  await flushPromises()
  expect(writes().map((request) => decodeURIComponent(request.path))).toEqual([
    '/api/v1/platform/modeling-instances/实例甲:archive',
    '/api/v1/platform/modeling-instances/实例甲:restore',
  ])
  expect(writes()[1]?.body).toEqual({ expected_revision: 8 })
  expect(
    writes().map((request) => request.headers.get('Idempotency-Key')),
  ).toEqual([expect.any(String), expect.any(String)])
  expect(wrapper.text()).not.toContain('删除实例')
})

it.each([
  { label: '批量归档实例', target: '在用', action: 'archive' },
  { label: '批量恢复实例', target: '已归档', action: 'restore' },
])('$label 跳过不适用的实例', async ({ label, target, action }) => {
  rows = [
    instance('在用'),
    instance('已归档', { archived_at: stamp }),
    instance('执行中', { latest_run: { ...run, status: 'running' } }),
  ]
  onWrite = () => response(instance(target))
  const wrapper = await open()
  await filter(wrapper, 'all')
  await selectAll(wrapper)
  await button(wrapper, label).trigger('click')
  await flushPromises()
  expect(writes().map((request) => decodeURIComponent(request.path))).toEqual([
    `/api/v1/platform/modeling-instances/${target}:${action}`,
  ])
  expect(wrapper.text()).toContain('未执行')
})

it('引用冲突按项显示失败并继续其他项，不把拒绝当成训练或归档完成', async () => {
  onWrite = (request) =>
    request.path.includes(encodeURIComponent('实例甲'))
      ? response(null, 409, '实例仍有部署引用')
      : response(instance('实例乙'))
  const wrapper = await open()
  await selectAll(wrapper)
  await button(wrapper, '批量归档实例').trigger('click')
  await flushPromises()
  expect(writes()).toHaveLength(2)
  expect(wrapper.text()).toContain('成功 1 项')
  expect(wrapper.text()).toContain('实例甲 · 失败：实例仍有部署引用')
})

it('网络结果未知立即停止剩余项且不会自动重试', async () => {
  onWrite = () => {
    throw new Error('network unavailable')
  }
  const wrapper = await open()
  await selectAll(wrapper)
  await button(wrapper, '批量提交训练').trigger('click')
  await flushPromises()
  expect(writes()).toHaveLength(1)
  expect(wrapper.text()).toContain('结果待核查')
  expect(wrapper.text()).toContain('此项未提交')
  expect(button(wrapper, '批量提交训练').attributes('disabled')).toBeDefined()
})

it('表格卡片切换保留选择，搜索、翻页、条数和归档筛选清空选择', async () => {
  const wrapper = await open()
  await selectAll(wrapper)
  await wrapper.get('button[aria-label="卡片视图"]').trigger('click')
  expect(wrapper.text()).toContain('已选择 2 项')
  await wrapper.get('input[type="search"]').setValue('实例甲')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
  await selectAll(wrapper)
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
  await selectAll(wrapper)
  wrapper.findComponent(ui.DtPagination).vm.$emit('update:size', 50)
  await flushPromises()
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
  await selectAll(wrapper)
  await filter(wrapper, 'all')
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
})

it('取消统一确认不提交任何单项写请求', async () => {
  ask.mockResolvedValue(false)
  const wrapper = await open()
  await selectAll(wrapper)
  await button(wrapper, '批量归档实例').trigger('click')
  await flushPromises()
  expect(writes()).toHaveLength(0)
})

it('权限撤销会清除既有选择并移除批量操作入口', async () => {
  const wrapper = await open()
  await selectAll(wrapper)
  expect(wrapper.text()).toContain('已选择 2 项')
  signIn(['modeling:view'])
  await flushPromises()
  expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  expect(wrapper.find('[aria-label="批量操作"]').exists()).toBe(false)
  expect(writes()).toHaveLength(0)
})

it('提交检索发送后端q并回第一页，可展示首屏外结果且不再本地过滤', async () => {
  onList = (url) =>
    response({
      items: [instance(url.searchParams.has('q') ? '后端第350条' : '首屏实例')],
      page: Number(url.searchParams.get('page')),
      size: 20,
      total: 350,
    })
  const wrapper = await open()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  await wrapper.get('input[type="search"]').setValue('  remote-code  ')
  expect(requests.filter((request) => request.method === 'GET')).toHaveLength(2)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  const query = new URL(requests.at(-1)?.url ?? 'http://test').searchParams
  expect(query.get('q')).toBe('remote-code')
  expect(query.get('page')).toBe('1')
  expect(query.get('size')).toBe('20')
  expect(wrapper.text()).toContain('后端第350条')
  expect(wrapper.text()).not.toContain('首屏实例')
  expect(wrapper.get('input[type="search"]').attributes('maxlength')).toBe(
    '128',
  )
})

it('归档末页最后一个实例后只纠正一次页码，返回仍有内容的前页', async () => {
  let archived = false
  onList = (url) => {
    const page = Number(url.searchParams.get('page'))
    return response({
      items:
        page === 1
          ? [instance('保留实例')]
          : archived
            ? []
            : [instance('末页实例')],
      page,
      size: 20,
      total: archived ? 20 : 21,
    })
  }
  onWrite = () => {
    archived = true
    return response(instance('末页实例', { archived_at: stamp }))
  }
  const wrapper = await open()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  await selectAll(wrapper)
  await button(wrapper, '批量归档实例').trigger('click')
  await flushPromises()
  expect(writes()).toHaveLength(1)
  expect(
    requests
      .filter((request) => request.method === 'GET')
      .map((request) => new URL(request.url).searchParams.get('page')),
  ).toEqual(['1', '2', '2', '1'])
  expect(wrapper.text()).toContain('保留实例')
  expect(wrapper.text()).not.toContain('末页实例')
})
