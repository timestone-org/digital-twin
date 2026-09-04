/**
 * @fileoverview 知识库页的行为契约。
 *
 * ⚠ 最要紧的三条：走回退档时必须**如实说出来**（悄悄退化的表现只是「检索有点
 * 慢、有点不准」，而没有人会去查一件没人说过的事，ADR-0034 决策五）；摄取是
 * 异步的，界面上必须给得出刷新入口且有处理中的行就自己轮询（不然用户只会一直
 * 盯着一个不动的「待处理」）；写权限的入口按权限码收起来——收不住的话，用户
 * 点了才在后端撞 403。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { DtFilePicker } from '@dt/ui'

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

const confirmSpy = vi.fn<() => Promise<boolean>>()
const toastSuccess = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: confirmSpy }),
    useToast: () => ({
      success: toastSuccess,
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    }),
  }
})

const READY: KnowledgeCapability = {
  isEmbeddingEnabled: true,
  isModelEnabled: true,
  isAsrEnabled: false,
  strategies: ['naive', 'hybrid', 'agentic'],
  readyStrategies: ['naive', 'hybrid', 'agentic'],
  acceptedSuffixes: ['.md', '.txt', '.docx', '.xlsx', '.pptx'],
  index: { vector: 'pgvector', keyword: 'trgm', reason: '' },
  rerank: {
    isEnabled: false,
    model: '',
    reason: '还没给「知识库重排」分配模型',
  },
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
    hasRaw: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    readyAt: '2026-09-01T00:01:00.000Z',
    ...patch,
  }
}

/** 一个能按名字放行的迟到者。 */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
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
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const ALL_CODES = ['knowledge:use', 'knowledge:write', 'knowledge:manage']

async function render(codes: string[] = ALL_CODES) {
  signIn(codes)
  const wrapper = mount(KnowledgePage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

function buttonOf(wrapper: VueWrapper, label: string) {
  return wrapper.findAll('button').find((one) => one.text() === label)
}

/** 弹窗 Teleport 到 body，wrapper 里找不到，只能从 body 找。 */
function modalButton(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('.dt-modal button')].find(
    (one) => one.textContent?.trim() === label,
  )
  if (!(found instanceof HTMLButtonElement)) {
    throw new Error(`弹窗里没有「${label}」按钮`)
  }
  return found
}

function modalField(selector: string): HTMLInputElement | HTMLTextAreaElement {
  const found = document.body.querySelector(`.dt-modal ${selector}`)
  if (
    !(found instanceof HTMLInputElement) &&
    !(found instanceof HTMLTextAreaElement)
  ) {
    throw new Error(`弹窗里没有 ${selector}`)
  }
  return found
}

function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  field.value = value
  field.dispatchEvent(new Event('input'))
}

async function search(wrapper: VueWrapper, query: string): Promise<void> {
  await wrapper.find('input[type="search"]').setValue(query)
  await buttonOf(wrapper, '检索')?.trigger('click')
  await flushPromises()
}

describe('首屏', () => {
  it('取能力与库清单，选中第一个并列出它的文档', async () => {
    const wrapper = await render()

    expect(api.readCapability).toHaveBeenCalledTimes(1)
    expect(api.listDocuments.mock.calls[0]?.[0]).toBe('b1')
    expect(wrapper.text()).toContain('运维手册')
    expect(wrapper.text()).toContain('一号机组.docx')
    expect(wrapper.text()).toContain('已就绪')
    expect(wrapper.text()).toContain('共 1 份 · 1 份已就绪')
  })

  it('一个库都没有时左右都是空态，不是一张空表', async () => {
    api.listBases.mockResolvedValue([])

    const wrapper = await render()

    expect(wrapper.text()).toContain('还没有知识库')
    expect(wrapper.text()).toContain('选择一个知识库')
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

  it('选中的那一行标 aria-current，读屏才知道当前在哪个库', async () => {
    api.listBases.mockResolvedValue([BASE, { ...BASE, id: 'b2', name: '乙' }])

    const wrapper = await render()

    const current = wrapper.findAll('button[aria-current="true"]')
    expect(current).toHaveLength(1)
    expect(current[0]?.text()).toContain('运维手册')
  })

  it('详情头摆出策略、嵌入档与向量维数', async () => {
    const wrapper = await render()

    expect(wrapper.text()).toContain('混合')
    expect(wrapper.text()).toContain('向量维数')
    expect(wrapper.text()).toContain('1536')
  })
})

describe('如实报索引的毛病', () => {
  it('维数对不上时把原因摆在页面上', async () => {
    api.readCapability.mockResolvedValue({
      ...READY,
      index: {
        vector: 'pgvector',
        keyword: 'trgm',
        reason:
          '这套部署的向量列是 1536 维，而分配的嵌入模型算出来的是 1024 维',
      },
      rerank: {
        isEnabled: false,
        model: '',
        reason: '还没给「知识库重排」分配模型',
      },
    })

    const wrapper = await render()

    expect(wrapper.text()).toContain('1024 维')
  })

  it('一切正常时不摆这条提示', async () => {
    // ⚠ 断言挑的是提示里独有的那半句：页面别处本来就写着「向量维数 1536」，
    // 拿「维数」去断言的话，这条用例永远红着而提示其实没出现
    const wrapper = await render()

    expect(wrapper.text()).not.toContain('1024 维')
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
    const refresh = wrapper.find('button[aria-label="刷新状态"]')
    expect(refresh.exists()).toBe(true)

    await refresh.trigger('click')
    await flushPromises()

    expect(api.listDocuments).toHaveBeenCalledTimes(2)
  })

  it('重新解析打对端点并提示已排队', async () => {
    api.reparseDocument.mockResolvedValue(documentOf({}))
    const wrapper = await render()

    await buttonOf(wrapper, '重新解析')?.trigger('click')
    await flushPromises()

    expect(api.reparseDocument).toHaveBeenCalledWith('d1')
    expect(toastSuccess).toHaveBeenCalledWith('已重新排队解析')
  })

  it('删除先问一句，取消就一个接口都不打', async () => {
    confirmSpy.mockResolvedValue(false)
    const wrapper = await render()

    await wrapper.find('button[aria-label="删除文档"]').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ danger: true, confirmText: '删除' }),
    )
    expect(api.deleteDocument).not.toHaveBeenCalled()
  })

  it('确认后才删，删完重取一次', async () => {
    confirmSpy.mockResolvedValue(true)
    api.deleteDocument.mockResolvedValue(undefined)
    const wrapper = await render()

    await wrapper.find('button[aria-label="删除文档"]').trigger('click')
    await flushPromises()

    expect(api.deleteDocument).toHaveBeenCalledWith('d1')
    expect(api.listDocuments).toHaveBeenCalledTimes(2)
    expect(toastSuccess).toHaveBeenCalledWith('已删除文档')
  })
})

describe('摄取轮询', () => {
  it('有处理中的行就每 5 秒重取，全部到终态即停', async () => {
    vi.useFakeTimers()
    api.listDocuments
      .mockResolvedValueOnce([documentOf({ status: 'parsing' })])
      .mockResolvedValue([documentOf({})])
    signIn(ALL_CODES)
    mount(KnowledgePage, { attachTo: document.body })
    await vi.advanceTimersByTimeAsync(0)
    expect(api.listDocuments).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(api.listDocuments).toHaveBeenCalledTimes(2)

    // 已到终态：再走几个周期也不该有新请求
    await vi.advanceTimersByTimeAsync(15000)
    expect(api.listDocuments).toHaveBeenCalledTimes(2)
  })

  it('全是终态就一次都不轮', async () => {
    vi.useFakeTimers()
    signIn(ALL_CODES)
    mount(KnowledgePage, { attachTo: document.body })
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(15000)

    expect(api.listDocuments).toHaveBeenCalledTimes(1)
  })

  it('离开页面就停，不对着一个没人看的状态打接口', async () => {
    vi.useFakeTimers()
    api.listDocuments.mockResolvedValue([documentOf({ status: 'parsing' })])
    signIn(ALL_CODES)
    const wrapper = mount(KnowledgePage, { attachTo: document.body })
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.listDocuments).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(10000)

    expect(api.listDocuments).toHaveBeenCalledTimes(2)
  })
})

describe('上传', () => {
  it('进度条上写着正在传哪一份，传完提示份数', async () => {
    const slow = deferred<KnowledgeDocument>()
    api.uploadDocument.mockReturnValue(slow.promise)
    const wrapper = await render()

    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['a'], 'a.md', { type: 'text/markdown' })])
    await flushPromises()
    expect(wrapper.text()).toContain('正在上传 a.md')

    slow.settle(documentOf({ id: 'd2', title: 'a.md', status: 'pending' }))
    await flushPromises()

    expect(wrapper.text()).not.toContain('正在上传')
    expect(toastSuccess).toHaveBeenCalledWith('已传 1 份文档，后台正在处理')
  })

  it('传炸了不弹成功提示，错误留在页面上', async () => {
    api.uploadDocument.mockRejectedValue(new Error('存储满了'))
    const wrapper = await render()

    wrapper
      .findComponent(DtFilePicker)
      .vm.$emit('select', [new File(['a'], 'a.md', { type: 'text/markdown' })])
    await flushPromises()

    expect(toastSuccess).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('存储满了')
  })
})

describe('检索试验台', () => {
  it('召回带出处，序号、命中词与正文对得上', async () => {
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

    await search(wrapper, '主蒸汽压力')

    expect(api.searchBase).toHaveBeenCalledWith('b1', '主蒸汽压力')
    expect(wrapper.text()).toContain('[1]')
    expect(wrapper.text()).toContain('一号机组.xlsx')
    expect(wrapper.text()).toContain('1月 · 第 3 行')
    expect(wrapper.text()).toContain('运行 > 参数')
    expect(wrapper.text()).toContain('向量 + 关键词双路命中')
    expect(wrapper.text()).toContain('主蒸汽压力上限 9.8 MPa')
    expect(wrapper.find('mark').text()).toBe('主蒸汽压力')
  })

  it('高亮按发出去的那句算，输入框里再改也不跟着跑', async () => {
    api.searchBase.mockResolvedValue({
      hits: [
        {
          chunkId: 'c1',
          documentTitle: '一号机组.xlsx',
          where: '',
          headingPath: '',
          text: '锅炉给水温度',
          score: 0.5,
          why: '',
        },
      ],
      strategy: 'hybrid',
      note: '',
    })
    const wrapper = await render()
    await search(wrapper, '给水')

    await wrapper.find('input[type="search"]').setValue('温度')

    expect(wrapper.find('mark').text()).toBe('给水')
  })

  it('退化的那一路要说出来，不能让人当成库里就这些', async () => {
    api.searchBase.mockResolvedValue({
      hits: [],
      strategy: 'naive',
      note: '这套部署没接嵌入档，本次只走了关键词那一路',
    })
    const wrapper = await render()

    await search(wrapper, '主蒸汽压力')

    expect(wrapper.text()).toContain('只走了关键词那一路')
    expect(wrapper.text()).toContain('这个库里没查到')
    expect(wrapper.find('mark').exists()).toBe(false)
  })

  it('后端说检索不了时，把那句话原样摆出来', async () => {
    // ⚠ 换成一句「操作失败」的话，用户查不到该去配什么
    api.searchBase.mockRejectedValue(
      new Error('这个库还没建过索引，先传几份文档等它就绪'),
    )
    const wrapper = await render()

    await search(wrapper, '锅炉')

    expect(wrapper.text()).toContain('先传几份文档等它就绪')
  })
})

describe('建库', () => {
  it('顶栏的新建走弹窗，建成后排到最前并切过去', async () => {
    api.createBase.mockResolvedValue({ ...BASE, id: 'b9', name: '新规程' })
    const wrapper = await render()

    await buttonOf(wrapper, '新建知识库')?.trigger('click')
    await flushPromises()
    type(modalField('input[type="text"]'), '新规程')
    type(modalField('textarea'), '锅炉启停规程')
    await flushPromises()
    modalButton('创建').click()
    await flushPromises()

    expect(api.createBase).toHaveBeenCalledWith(
      '新规程',
      '锅炉启停规程',
      'hybrid',
    )
    expect(document.body.querySelector('.dt-modal')).toBeNull()
    expect(wrapper.text()).toContain('新规程')
    expect(api.listDocuments).toHaveBeenLastCalledWith('b9', expect.anything())
  })

  it('名字空着时创建键按不下去', async () => {
    const wrapper = await render()

    await buttonOf(wrapper, '新建知识库')?.trigger('click')
    await flushPromises()

    expect(modalButton('创建').disabled).toBe(true)
    expect(api.createBase).not.toHaveBeenCalled()
  })

  it('建库炸了那句话显示在弹窗里，弹窗不关', async () => {
    api.createBase.mockRejectedValue(new Error('同名的库已经有了'))
    const wrapper = await render()

    await buttonOf(wrapper, '新建知识库')?.trigger('click')
    await flushPromises()
    type(modalField('input[type="text"]'), '运维手册')
    await flushPromises()
    modalButton('创建').click()
    await flushPromises()

    const modal = document.body.querySelector('.dt-modal')
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toContain('同名的库已经有了')
  })

  it('左栏空态里也有新建入口', async () => {
    api.listBases.mockResolvedValue([])
    const wrapper = await render()

    const entries = wrapper
      .findAll('button')
      .filter((one) => one.text() === '新建知识库')

    expect(entries).toHaveLength(2)
  })
})

describe('删除知识库', () => {
  it('先问一句，取消就不打接口', async () => {
    confirmSpy.mockResolvedValue(false)
    const wrapper = await render()

    await wrapper.find('button[aria-label="删除知识库"]').trigger('click')
    await flushPromises()

    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: '删除知识库', danger: true }),
    )
    expect(api.deleteBase).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('运维手册')
  })

  it('确认后删掉，左右一起回到空态', async () => {
    confirmSpy.mockResolvedValue(true)
    api.deleteBase.mockResolvedValue(undefined)
    const wrapper = await render()

    await wrapper.find('button[aria-label="删除知识库"]').trigger('click')
    await flushPromises()

    expect(api.deleteBase).toHaveBeenCalledWith('b1')
    expect(toastSuccess).toHaveBeenCalledWith('已删除知识库')
    expect(wrapper.text()).toContain('还没有知识库')
    expect(wrapper.text()).toContain('选择一个知识库')
  })
})

describe('权限', () => {
  it('只有 use 时看不到建库、传文档与改文档的入口', async () => {
    // ⚠ 收不住的话，用户点了才在后端撞 403，而那时他已经选完文件了
    const wrapper = await render(['knowledge:use'])

    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).not.toContain('新建知识库')
    expect(labels).not.toContain('重新解析')
    expect(wrapper.find('button[aria-label="删除文档"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="删除知识库"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('传文档')
  })

  it('有 write 但没有 manage 时，能改文档不能建库删库', async () => {
    const wrapper = await render(['knowledge:use', 'knowledge:write'])

    const labels = wrapper.findAll('button').map((one) => one.text())
    expect(labels).toContain('重新解析')
    expect(labels).not.toContain('新建知识库')
    expect(wrapper.find('button[aria-label="删除知识库"]').exists()).toBe(false)
  })

  it('试验台上把重排接没接如实说出来', async () => {
    // ⚠ 没接时召回按融合名次给出：谁都没说过这一路在哪一档上的话，
    // 「质量跟别处不一样」是查不动的
    const wrapper = await render()
    expect(wrapper.text()).toContain('未接重排')
    expect(wrapper.text()).toContain('还没给「知识库重排」分配模型')
  })
})
