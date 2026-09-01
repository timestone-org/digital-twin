/**
 * @fileoverview 知识库页的行为契约。
 *
 * ⚠ 最要紧的三条：走回退档时必须**如实说出来**（悄悄退化的表现只是「检索有点
 * 慢、有点不准」，而没有人会去查一件没人说过的事，ADR-0034 决策五）；摄取是
 * 异步的，界面上必须给得出刷新入口（不然用户只会一直盯着一个不动的「待处理」）；
 * 写权限的入口按权限码收起来——收不住的话，用户点了才在后端撞 403。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import type {
  KnowledgeBase,
  KnowledgeCapability,
  KnowledgeDocument,
} from '@/api/knowledge'
import KnowledgePage from '@/pages/Knowledge/index.vue'
import { useAuthStore } from '@/stores/auth'

const api = vi.hoisted(() => ({
  readCapability: vi.fn(),
  listBases: vi.fn(),
  listDocuments: vi.fn(),
  createBase: vi.fn(),
  deleteBase: vi.fn(),
  uploadDocument: vi.fn(),
  reparseDocument: vi.fn(),
  deleteDocument: vi.fn(),
  searchBase: vi.fn(),
}))

vi.mock('@/api/knowledge', () => api)

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/knowledge', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const READY: KnowledgeCapability = {
  isEmbeddingEnabled: true,
  isModelEnabled: true,
  strategies: ['naive', 'hybrid', 'agentic'],
  readyStrategies: ['naive', 'hybrid', 'agentic'],
  acceptedSuffixes: ['.md', '.txt', '.docx', '.xlsx', '.pptx'],
  index: { vector: 'pgvector', keyword: 'trgm', reason: '' },
}

const BASE: KnowledgeBase = {
  id: 'b1',
  name: '运维手册',
  description: '',
  strategy: 'hybrid',
  embeddingModel: 'text-embedding-3-small',
  dimensions: 1536,
  documentCount: 2,
  createdAt: '2026-09-01T00:00:00.000Z',
}

function documentOf(patch: Partial<KnowledgeDocument>): KnowledgeDocument {
  return {
    id: 'd1',
    title: '一号机组.docx',
    status: 'ready',
    failureReason: '',
    chunkCount: 12,
    sizeBytes: 2048,
    createdAt: '2026-09-01T00:00:00.000Z',
    readyAt: '2026-09-01T00:01:00.000Z',
    ...patch,
  }
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'heyufan',
    permissions: codes,
    role_permissions: codes,
  } as never
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  api.readCapability.mockResolvedValue(READY)
  api.listBases.mockResolvedValue([BASE])
  api.listDocuments.mockResolvedValue([documentOf({})])
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

const ALL_CODES = ['knowledge:use', 'knowledge:write', 'knowledge:manage']

async function render(codes: string[] = ALL_CODES) {
  signIn(codes)
  const wrapper = mount(KnowledgePage)
  await flushPromises()
  return wrapper
}

describe('首屏', () => {
  it('取能力与库清单，选中第一个并列出它的文档', async () => {
    const wrapper = await render()

    expect(api.readCapability).toHaveBeenCalledTimes(1)
    expect(api.listDocuments.mock.calls[0]?.[0]).toBe('b1')
    expect(wrapper.text()).toContain('运维手册')
    expect(wrapper.text()).toContain('一号机组.docx')
    expect(wrapper.text()).toContain('已就绪')
  })

  it('一个库都没有时给的是空态，不是一张空表', async () => {
    api.listBases.mockResolvedValue([])

    const wrapper = await render()

    expect(wrapper.text()).toContain('先选一个知识库')
  })

  it('左栏的未建索引与嵌入档分开说', async () => {
    // ⚠ 不说的话，用户会对着一个永远搜不到东西的库反复上传
    api.listBases.mockResolvedValue([
      BASE,
      { ...BASE, id: 'b2', name: '新库', embeddingModel: null },
    ])

    const wrapper = await render()

    expect(wrapper.text()).toContain('text-embedding-3-small')
    expect(wrapper.text()).toContain('未建索引')
  })
})

describe('如实报索引档', () => {
  it('走回退档时把原因摆在页面上', async () => {
    api.readCapability.mockResolvedValue({
      ...READY,
      index: {
        vector: 'bruteforce',
        keyword: 'like',
        reason: '这套部署的数据库没装 pgvector，检索走的是全表暴力比对',
      },
    })

    const wrapper = await render()

    expect(wrapper.text()).toContain('没装 pgvector')
  })

  it('走在首选档上时不摆这条提示', async () => {
    const wrapper = await render()

    expect(wrapper.text()).not.toContain('pgvector')
  })
})

describe('文档表', () => {
  it('失败原因直接显示在行里', async () => {
    // ⚠ 藏进详情的话，用户只看得到一个红色的「失败」
    api.listDocuments.mockResolvedValue([
      documentOf({
        status: 'failed',
        failureReason: '认不出 .pdf 是什么格式',
        chunkCount: 0,
      }),
    ])

    const wrapper = await render()

    expect(wrapper.text()).toContain('失败')
    expect(wrapper.text()).toContain('认不出 .pdf 是什么格式')
  })

  it('中间状态各有各的说法，不都叫处理中', async () => {
    api.listDocuments.mockResolvedValue([
      documentOf({ id: 'd1', status: 'parsing' }),
      documentOf({ id: 'd2', status: 'embedding' }),
      documentOf({ id: 'd3', status: 'indexing' }),
    ])

    const wrapper = await render()

    expect(wrapper.text()).toContain('解析中')
    expect(wrapper.text()).toContain('嵌入中')
    expect(wrapper.text()).toContain('建索引中')
  })

  it('摄取是异步的，所以给得出刷新入口', async () => {
    const wrapper = await render()
    const refresh = wrapper
      .findAll('button')
      .find((one) => one.text() === '刷新状态')
    expect(refresh).toBeDefined()

    await refresh?.trigger('click')
    await flushPromises()

    expect(api.listDocuments).toHaveBeenCalledTimes(2)
  })

  it('重新解析与删除各自打各自的端点', async () => {
    api.reparseDocument.mockResolvedValue(documentOf({}))
    api.deleteDocument.mockResolvedValue(undefined)
    const wrapper = await render()

    const buttons = wrapper.findAll('button')
    await buttons.find((one) => one.text() === '重新解析')?.trigger('click')
    await flushPromises()
    await buttons.find((one) => one.text() === '删除')?.trigger('click')
    await flushPromises()

    expect(api.reparseDocument).toHaveBeenCalledWith('d1')
    expect(api.deleteDocument).toHaveBeenCalledWith('d1')
  })
})

describe('检索试验台', () => {
  it('召回带出处，且序号与正文对得上', async () => {
    // ⚠ 指不出出处的召回，用户没法核对，也就判断不了这个库配得对不对
    api.searchBase.mockResolvedValue({
      hits: [
        {
          chunkId: 'c1',
          documentTitle: '一号机组.xlsx',
          where: '1月 · 第 3 行',
          headingPath: '运行 > 参数',
          text: '主蒸汽压力上限 9.8 MPa',
          score: 0.91,
          why: '向量 + 关键词双路命中',
        },
      ],
      strategy: 'hybrid',
      note: '',
    })
    const wrapper = await render()

    await wrapper.find('input[type="search"]').setValue('主蒸汽压力')
    await wrapper
      .findAll('button')
      .find((one) => one.text() === '检索')
      ?.trigger('click')
    await flushPromises()

    expect(api.searchBase).toHaveBeenCalledWith('b1', '主蒸汽压力')
    expect(wrapper.text()).toContain('[1] 一号机组.xlsx')
    expect(wrapper.text()).toContain('1月 · 第 3 行')
    expect(wrapper.text()).toContain('主蒸汽压力上限 9.8 MPa')
  })

  it('退化的那一路要说出来，不能让人当成库里就这些', async () => {
    api.searchBase.mockResolvedValue({
      hits: [],
      strategy: 'naive',
      note: '这套部署没接嵌入档，本次只走了关键词那一路',
    })
    const wrapper = await render()

    await wrapper.find('input[type="search"]').setValue('主蒸汽压力')
    await wrapper
      .findAll('button')
      .find((one) => one.text() === '检索')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('只走了关键词那一路')
    expect(wrapper.text()).toContain('这个库里没查到')
  })

  it('后端说检索不了时，把那句话原样摆出来', async () => {
    // ⚠ 换成一句「操作失败」的话，用户查不到该去配什么
    api.searchBase.mockRejectedValue(
      new Error('这个库还没建过索引，先传几份文档等它就绪'),
    )
    const wrapper = await render()

    await wrapper.find('input[type="search"]').setValue('锅炉')
    await wrapper
      .findAll('button')
      .find((one) => one.text() === '检索')
      ?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('先传几份文档等它就绪')
  })
})

describe('权限', () => {
  it('只有 use 时看不到建库、传文档与改文档的入口', async () => {
    // ⚠ 收不住的话，用户点了才在后端撞 403，而那时他已经选完文件了
    const wrapper = await render(['knowledge:use'])

    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).not.toContain('建')
    expect(labels).not.toContain('重新解析')
    expect(labels).not.toContain('删除')
    expect(wrapper.text()).not.toContain('传文档')
  })

  it('有 write 但没有 manage 时，能改文档不能建库', async () => {
    const wrapper = await render(['knowledge:use', 'knowledge:write'])

    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).toContain('重新解析')
    expect(labels).not.toContain('建')
  })

  it('齐全时建库把新库排到最前并切过去', async () => {
    api.createBase.mockResolvedValue({ ...BASE, id: 'b9', name: '新规程' })
    const wrapper = await render()

    await wrapper
      .find('input[aria-label="新建知识库的名字"]')
      .setValue('新规程')
    await wrapper
      .findAll('button')
      .find((one) => one.text() === '建')
      ?.trigger('click')
    await flushPromises()

    expect(api.createBase).toHaveBeenCalledWith('新规程', '', 'hybrid')
    expect(wrapper.text()).toContain('新规程')
  })
})
