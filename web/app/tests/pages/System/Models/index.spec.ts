/**
 * @fileoverview 模型管理页的行为契约。
 *
 * ⚠ 最要紧的几条：页面上**永远不出现密钥明文**（后端也不回，只有尾巴）；
 * 删供应商要二次确认，还被用途指着的一路根本删不了；没有 `llm:view` 的人
 * 看不到目录；订阅账号那一节只在助手接了那一路、且持 `assistant:manage` 时出现。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'
import type { LlmProvider, LlmProviderKind, LlmPurpose } from '@dt/contracts'

import * as assistant from '@/api/assistant'
import { BizError } from '@/api/client'
import * as knowledge from '@/api/knowledge'
import * as llm from '@/api/llmProviders'
import PurposeBoard from '@/pages/System/Models/components/PurposeBoard.vue'
import ModelsPage from '@/pages/System/Models/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/system/models', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const VIEW = 'llm:view'
const MANAGE = 'llm:manage'

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

function provider(over: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: 'p1',
    name: '百炼',
    kind: 'openai_compat',
    base_url: 'https://endpoint/compatible-mode/v1',
    api_key_hint: '…1234',
    is_enabled: true,
    extra_body: null,
    options: null,
    models: [
      { name: 'qwen-plus', kind: 'chat', has_vision: true, dimensions: null },
    ],
    notes: '',
    assigned_purposes: [],
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function purpose(over: Partial<LlmPurpose> = {}): LlmPurpose {
  return {
    purpose: 'assistant.chat',
    label: '对话',
    description: '助手每一轮对话走的模型',
    kind: 'chat',
    consumer: 'assistant',
    is_vision_required: false,
    provider_id: null,
    provider_name: null,
    model_name: null,
    updated_at: null,
    ...over,
  }
}

function capability(models: unknown[]) {
  return {
    is_model_enabled: models.length > 0,
    skills: [],
    models,
    default_model_id: 'default',
    default_effort: 'medium',
    attachment_suffixes: [],
  } as never
}

/** 目录里配出来的一路订阅账号：它在这一页上摆的是登录，不是端点。 */
const CODEX_KIND: LlmProviderKind = {
  code: 'codex_oauth',
  label: 'Codex 订阅',
  description: '登录一次',
  is_endpoint_required: false,
  is_login_required: true,
  model_kinds: ['chat'],
  consumers: ['assistant'],
  efforts: ['low', 'medium', 'high', 'xhigh'],
  presets: [],
}

/** 后端下发的形态清单：表格与表单都按它摆。 */
const KIND: LlmProviderKind = {
  code: 'openai_compat',
  label: 'OpenAI 兼容端点',
  description: '填端点与密钥',
  is_endpoint_required: true,
  is_login_required: false,
  model_kinds: ['chat', 'embedding'],
  consumers: ['assistant', 'knowledge'],
  efforts: [],
  presets: [],
}

function page<T>(items: T[]) {
  return { items, page: 1, size: 200, total: items.length }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.spyOn(llm, 'listProviders').mockResolvedValue(page([provider()]))
  vi.spyOn(llm, 'listKinds').mockResolvedValue([KIND])
  vi.spyOn(llm, 'listPurposes').mockResolvedValue([purpose()])
  vi.spyOn(assistant, 'probeCapability').mockResolvedValue(capability([]))
  vi.spyOn(llm, 'readCredential').mockResolvedValue(null)
  vi.spyOn(knowledge, 'readCapability').mockRejectedValue(new Error('502'))
})

enableAutoUnmount(afterEach)

afterEach(() => {
  useToast().clear()
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

async function render(codes: string[] = [VIEW, MANAGE]) {
  const auth = useAuthStore()
  auth.user = user(codes)
  auth.accessToken = 'token'
  const wrapper = mount(ModelsPage)
  await flushPromises()
  return wrapper
}

async function renderWithHosts(codes?: string[]) {
  const wrapper = await render(codes)
  mount(DtConfirmHost)
  mount(DtToastHost)
  await flushPromises()
  return wrapper
}

async function click(
  wrapper: ReturnType<typeof mount>,
  label: string,
): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find(
      (node) =>
        node.text().includes(label) || node.attributes('aria-label') === label,
    )
  await button?.trigger('click')
  await flushPromises()
}

async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  button?.click()
  await flushPromises()
}

describe('模型管理页', () => {
  it('列出供应商、登记的模型与密钥尾巴，永远没有明文', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('百炼')
    expect(wrapper.text()).toContain('qwen-plus')
    expect(wrapper.text()).toContain('…1234')
    expect(wrapper.text()).not.toContain('sk-')
  })

  it('用途那一栏列出每个用途，没分配的写清沿用环境变量', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('对话')
    expect(wrapper.text()).toContain('沿用该服务环境变量里的配置')
  })

  it('目录没开时如实说，并指向那一格配置', async () => {
    vi.spyOn(llm, 'listProviders').mockRejectedValue(
      new BizError(52401, '本部署没开模型供应商目录', 503, 't'),
    )
    vi.spyOn(llm, 'listPurposes').mockRejectedValue(
      new BizError(52401, '本部署没开模型供应商目录', 503, 't'),
    )
    const wrapper = await render()
    expect(wrapper.text()).toContain('PLATFORM_LLM_PROVIDER_SECRET')
  })

  it('助手没部署时「当前生效」那一栏如实缺席，整页照常', async () => {
    vi.spyOn(assistant, 'probeCapability').mockResolvedValue(null)
    const wrapper = await render()
    expect(wrapper.text()).toContain('没接助手')
    expect(wrapper.text()).toContain('没接知识库')
    expect(wrapper.text()).toContain('百炼')
  })

  it('删供应商要二次确认', async () => {
    const remove = vi.spyOn(llm, 'deleteProvider').mockResolvedValue(undefined)
    const wrapper = await renderWithHosts()
    await click(wrapper, '删除')
    expect(remove).not.toHaveBeenCalled()
    await clickInConfirm('删除')
    expect(remove).toHaveBeenCalledWith('p1')
  })

  it('还被用途指着的供应商删不了，只告诉人先改用途', async () => {
    vi.spyOn(llm, 'listProviders').mockResolvedValue(
      page([provider({ assigned_purposes: ['assistant.chat'] })]),
    )
    const remove = vi.spyOn(llm, 'deleteProvider').mockResolvedValue(undefined)
    const wrapper = await renderWithHosts()
    await click(wrapper, '删除')
    expect(document.body.textContent).toContain('先把那些用途改指别处')
    await clickInConfirm('知道了')
    expect(remove).not.toHaveBeenCalled()
  })

  it('点新建就打开表单弹窗', async () => {
    const wrapper = await render()
    await click(wrapper, '新建供应商')
    expect(document.body.textContent).toContain('新建供应商')
    expect(document.body.textContent).toContain('端点地址')
  })

  it('测试连接把结果作为一条反馈说出来', async () => {
    vi.spyOn(llm, 'probeProvider').mockResolvedValue({
      is_ok: true,
      message: '端点可用，自报 3 个模型',
      model_names: [],
    })
    const wrapper = await renderWithHosts()
    await click(wrapper, '测试连接')
    expect(document.body.textContent).toContain('端点可用')
  })

  it('改了一个用途之后重拉两侧的能力面', async () => {
    const assign = vi.spyOn(llm, 'assignPurpose').mockResolvedValue(
      purpose({
        provider_id: 'p1',
        provider_name: '百炼',
        model_name: 'qwen-plus',
      }),
    )
    const wrapper = await renderWithHosts()
    const board = wrapper.findComponent(PurposeBoard)
    board.vm.$emit('assign', 'assistant.chat', 'p1', 'qwen-plus')
    await flushPromises()
    expect(assign).toHaveBeenCalledWith('assistant.chat', {
      provider_id: 'p1',
      model_name: 'qwen-plus',
    })
    // 首次加载一次 + 分配之后一次
    expect(assistant.probeCapability).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('当前：百炼 / qwen-plus')
  })

  it('订阅账号那一节只在目录里真配了那一路且持 llm:manage 时出现', async () => {
    // ⚠ 登录态挂在那一行供应商上（ADR-0041）：目录里一路都没有时摆出登录键，
    // 点下去是一条指不回任何地方的错
    vi.spyOn(llm, 'listKinds').mockResolvedValue([KIND, CODEX_KIND])
    vi.spyOn(llm, 'listProviders').mockResolvedValue(
      page([provider({ id: 'p2', name: '我的 Codex', kind: 'codex_oauth' })]),
    )
    const withCode = await render([VIEW, MANAGE])
    expect(withCode.text()).toContain('登录账号')
    withCode.unmount()
    const without = await render([VIEW])
    expect(without.text()).not.toContain('登录账号')
  })

  it('目录里配出来的订阅账号那一路各摆一份登录，端点那几路不受影响', async () => {
    vi.spyOn(llm, 'listKinds').mockResolvedValue([KIND, CODEX_KIND])
    vi.spyOn(llm, 'listProviders').mockResolvedValue(
      page([
        provider(),
        provider({ id: 'p2', name: '我的 Codex', kind: 'codex_oauth' }),
      ]),
    )
    const wrapper = await render([VIEW, MANAGE])
    expect(wrapper.text()).toContain('我的 Codex')
    expect(wrapper.text()).toContain('登录账号')
    // ⚠ 打的是 platform 那一族：登录态与那一行供应商同属主
    expect(llm.readCredential).toHaveBeenCalledWith('p2')
  })

  it('没有端点的那一路不摆「测试连接」', async () => {
    // ⚠ 摆出来的话点下去收到的是一条 400：那一路根本没有地址可探
    vi.spyOn(llm, 'listKinds').mockResolvedValue([CODEX_KIND])
    vi.spyOn(llm, 'listProviders').mockResolvedValue(
      page([provider({ id: 'p2', name: '我的 Codex', kind: 'codex_oauth' })]),
    )
    const wrapper = await render()
    expect(wrapper.find('button[aria-label="测试连接"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="编辑"]').exists()).toBe(true)
  })

  it('只有 llm:view 的人看得见目录但没有任何写按钮', async () => {
    const wrapper = await render([VIEW])
    expect(wrapper.text()).toContain('百炼')
    expect(wrapper.text()).toContain('只读')
    expect(wrapper.find('button[aria-label="删除"]').exists()).toBe(false)
  })

  it('没有 llm:view 的人什么目录都看不到', async () => {
    const wrapper = await render([])
    expect(wrapper.text()).not.toContain('百炼')
  })
})
