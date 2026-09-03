/**
 * @fileoverview 引用卡片：一份文档一行、只列用到的页、展开才看原文与图。
 *
 * ⚠ 有一条是为「模板里用了没导入的组件会**静默不渲染**」而设的：
 * typecheck 与 lint 对那种错双双放行（见 [[vue-props-slots-unchecked]]），
 * 只有真挂载起来数一遍才逮得到。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { KnowledgeCitation } from '@dt/contracts'

import AiCitations from '@/components/ai/AiCitations.vue'
import AiTimeline from '@/components/ai/AiTimeline.vue'

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

  it('图走服务端取图端点，不是对象存储直链', async () => {
    // ⚠ 知识库的图不匿名可读：直链取不到，而那时界面上是一个坏掉的图标
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
    expect(made.find('img').attributes('src')).toBe(
      '/api/v1/knowledge/documents/d1/figures/f1',
    )
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
