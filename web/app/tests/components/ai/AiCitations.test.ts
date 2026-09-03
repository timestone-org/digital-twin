/**
 * @fileoverview 引用卡片：一份文档一行、只列用到的页、展开才看原文与图。
 *
 * ⚠ 有一条是为「模板里用了没导入的组件会**静默不渲染**」而设的：
 * typecheck 与 lint 对那种错双双放行（见 [[vue-props-slots-unchecked]]），
 * 只有真挂载起来数一遍才逮得到。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeCitation } from '@dt/contracts'

import AiCitations from '@/components/ai/AiCitations.vue'
import AiTimeline from '@/components/ai/AiTimeline.vue'

const api = vi.hoisted(() => ({ readFigureBytes: vi.fn() }))

vi.mock('@/api/knowledge', () => api)

// happy-dom 没有 object URL：桩成可预测的串，收起那一条才数得出放掉了谁
let made = 0
const revoked: string[] = []

beforeEach(() => {
  made = 0
  revoked.length = 0
  api.readFigureBytes.mockReset()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:fake/f${(made += 1)}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function cite(
  marker: string,
  documentId: string,
  page: number | null,
  pageEnd: number | null = null,
  figures: KnowledgeCitation['figures'] = [],
): KnowledgeCitation {
  return {
    marker,
    chunk_id: `c-${marker}`,
    document_id: documentId,
    document_title: documentId === 'd1' ? '现场手册' : '维护规程',
    base_name: '手册库',
    heading_path: '二、运行参数',
    where: page === null ? '二、运行参数' : `第 ${page} 页 · 二、运行参数`,
    page,
    page_end: pageEnd,
    text: '出口温度不得高于 65 ℃',
    figures,
  }
}

describe('引用卡片', () => {
  it('一份文档一行，页码合并成区间', () => {
    const made = mount(AiCitations, {
      props: { items: [cite('①', 'd1', 4, 6), cite('②', 'd1', 9)] },
    })
    expect(made.findAll('.cites__doc')).toHaveLength(1)
    expect(made.text()).toContain('现场手册')
    expect(made.text()).toContain('第 4–6、9 页')
  })

  it('角标与答案正文里那个字符逐字一致', () => {
    // ⚠ 绝不重新编号：用户扫到正文里的 ③，要在这里找同一个 ③
    const made = mount(AiCitations, { props: { items: [cite('③', 'd1', 4)] } })
    expect(made.find('.cites__mark').text()).toBe('③')
  })

  it('默认全收起，点开才有原文', () => {
    // ⚠ 依据是给要核对的人看的：默认摊开会把答案挤到屏幕外
    const made = mount(AiCitations, { props: { items: [cite('①', 'd1', 4)] } })
    expect(made.text()).not.toContain('出口温度不得高于')
    return made
      .find('.cites__row')
      .trigger('click')
      .then(() => {
        expect(made.text()).toContain('出口温度不得高于')
      })
  })

  it('图取字节再转 object URL，不把端点地址写进 src', async () => {
    // ⚠ 浏览器给 `<img>` 的请求带不上 Authorization，而知识库的图要认人：
    // 把端点地址写进 src 的表现是整张图 401、界面上一个碎图标，且不报任何错
    api.readFigureBytes.mockResolvedValue(new Blob(['x']))
    const made = mount(AiCitations, {
      props: {
        items: [
          cite('①', 'd1', 4, null, [
            { id: 'f1', caption: '图 1 冷却水回路', page: 4 },
          ]),
        ],
      },
    })

    await made.find('.cites__row').trigger('click')
    await flushPromises()

    expect(api.readFigureBytes.mock.calls[0]?.slice(0, 2)).toEqual(['d1', 'f1'])
    expect(made.find('img').attributes('src')).toBe('blob:fake/f1')
  })

  it('收起时把 object URL 放掉', async () => {
    // ⚠ 不放的表现是内存里攒着一堆图，翻十几条依据之后整页开始卡
    api.readFigureBytes.mockResolvedValue(new Blob(['x']))
    const made = mount(AiCitations, {
      props: {
        items: [cite('①', 'd1', 4, null, [{ id: 'f1', caption: '', page: 4 }])],
      },
    })
    await made.find('.cites__row').trigger('click')
    await flushPromises()

    await made.find('.cites__row').trigger('click')

    expect(revoked).toContain('blob:fake/f1')
  })

  it('卸载时把 object URL 放掉', async () => {
    // ⚠ 卸载必须清理：对话翻页时整块时间线会被换掉，不放的话每翻一次就漏一批
    api.readFigureBytes.mockResolvedValue(new Blob(['x']))
    const made = mount(AiCitations, {
      props: {
        items: [cite('①', 'd1', 4, null, [{ id: 'f1', caption: '', page: 4 }])],
      },
    })
    await made.find('.cites__row').trigger('click')
    await flushPromises()

    made.unmount()

    expect(revoked).toContain('blob:fake/f1')
  })

  it('一张图取不回来时不摆出来，也不盖住答案', async () => {
    // ⚠ 不弹错：一张图取不到不该把整条依据变成一条报错
    api.readFigureBytes.mockRejectedValue(new Error('401'))
    const made = mount(AiCitations, {
      props: {
        items: [cite('①', 'd1', 4, null, [{ id: 'f1', caption: '', page: 4 }])],
      },
    })

    await made.find('.cites__row').trigger('click')
    await flushPromises()

    expect(made.find('img').exists()).toBe(false)
    expect(made.text()).toContain('出口温度不得高于 65 ℃')
  })

  it('没有页码的格式不硬凑一个页码', () => {
    // ⚠ docx / md 根本没有页这个概念；凑一个「第 1 页」是在说假话
    const made = mount(AiCitations, {
      props: { items: [cite('①', 'd1', null)] },
    })
    expect(made.text()).not.toContain('页')
  })
})

describe('时间线挂载', () => {
  it('citations 那一档真的画出来了', () => {
    // ⚠ 这一条守的是「模板里用了没导入的组件」：那种错 typecheck 与 lint
    // 双双放行，只会静默不渲染——只有真挂载起来数一遍才逮得到
    const made = mount(AiTimeline, {
      props: {
        entries: [
          {
            id: 'e1',
            role: 'citations' as const,
            text: '',
            citations: [cite('①', 'd1', 4)],
          },
        ],
        starters: [],
      },
    })
    expect(made.findComponent(AiCitations).exists()).toBe(true)
    expect(made.text()).toContain('现场手册')
  })
})
