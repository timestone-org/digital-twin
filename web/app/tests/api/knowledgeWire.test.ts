/**
 * @fileoverview 知识库线形窄化的边界：缺字段、错类型、认不出的枚举各走哪一条。
 *
 * ⚠ 这一层不是形式主义：`as` 断言会让一个错形状一路流进界面，最后崩在某个深层
 * 组件里（「读不出 undefined 的 length」），而真正的错在这里就该被说出来。
 */
import { describe, expect, it } from 'vitest'

import { TransportError } from '@/api/client'
import {
  toBase,
  toCapability,
  toDocument,
  toSearchResult,
  toSource,
  toUploadTicket,
} from '@/api/knowledgeWire'

describe('知识库的窄化', () => {
  it('库的空描述与未建索引分别落成空串与 null', () => {
    // ⚠ null 是「这个库还没建过索引」，空串看起来像「模型名忘了填」
    const made = toBase({
      id: 'b1',
      name: '手册',
      retrieval_strategy: 'naive',
      embedding_model: '',
      dimensions: null,
    })

    expect(made.description).toBe('')
    expect(made.embeddingModel).toBeNull()
    expect(made.dimensions).toBeNull()
    expect(made.documentCount).toBe(0)
  })

  it('认不出的检索策略直接拒，不静默回落', () => {
    // ⚠ 回落的那一种会让界面显示的策略与实际跑的不是同一个，而两边都不报错
    expect(() =>
      toBase({ id: 'b1', name: '手册', retrieval_strategy: 'graphrag' }),
    ).toThrow(TransportError)
  })

  it('认不出的文档状态当成待处理，绝不当成已就绪', () => {
    // ⚠ 反过来落到 ready 的话，一份还没解析完的文档会被当成可检索的
    expect(toDocument({ id: 'd1', status: 'transmogrifying' }).status).toBe(
      'pending',
    )
    expect(toDocument({ id: 'd1', status: 'failed' }).status).toBe('failed')
  })

  it('不是对象的响应在这一层就说出来', () => {
    expect(() => toBase(null)).toThrow(/知识库/)
    expect(() => toSource([])).toThrow(/来源/)
    expect(() => toDocument('ok')).toThrow(/文档/)
    expect(() => toSearchResult(7)).toThrow(/检索/)
    expect(() => toUploadTicket(null)).toThrow(/直传凭证/)
    expect(() => toCapability(null)).toThrow(/能力/)
  })

  it('召回的位置取自 locator.label，前端不再拼一份', () => {
    const made = toSearchResult({
      hits: [
        {
          chunk_id: 'c1',
          document_title: '一号机组.xlsx',
          locator: { label: '1月 · 第 3 行' },
          heading_path: '运行 > 参数',
          text: '主蒸汽压力',
          score: 0.87,
          why: '关键词命中',
        },
      ],
      strategy: 'hybrid',
      note: '',
    })

    expect(made.hits[0]?.where).toBe('1月 · 第 3 行')
    expect(made.hits[0]?.score).toBeCloseTo(0.87)
  })

  it('召回缺 locator 时位置是空串而不是崩', () => {
    const made = toSearchResult({ hits: [{ chunk_id: 'c1' }] })

    expect(made.hits[0]?.where).toBe('')
    expect(made.strategy).toBe('')
  })

  it('直传凭证的字段逐个窄成字符串', () => {
    const made = toUploadTicket({
      document_id: 'd1',
      url: '/oss/',
      fields: { key: 'staging/kb/d1', 'x-amz-meta-n': 7 },
      expires_seconds: 900,
    })

    expect(made.fields.key).toBe('staging/kb/d1')
    expect(made.fields['x-amz-meta-n']).toBe('')
  })

  it('能力里的开关只认真正的 true', () => {
    // ⚠ 用真值判断的话，后端回一个 "false" 字符串会被读成开着的
    const made = toCapability({
      is_embedding_enabled: 'false',
      is_model_enabled: true,
      strategies: ['naive', 7, ''],
      ready_strategies: [],
      accepted_suffixes: ['.md', '.docx'],
      index: { vector: 'bruteforce', keyword: 'like', reason: '没装 pgvector' },
    })

    expect(made.isEmbeddingEnabled).toBe(false)
    expect(made.isModelEnabled).toBe(true)
    expect(made.strategies).toEqual(['naive'])
    expect(made.acceptedSuffixes).toEqual(['.md', '.docx'])
    expect(made.index.reason).toBe('没装 pgvector')
  })

  it('能力缺 index 那一格时在这一层就说出来', () => {
    // ⚠ 缺了还往下走的话，界面会崩在读 index.vector 上
    expect(() => toCapability({ is_embedding_enabled: true })).toThrow(/索引档/)
  })

  it('来源的没同步过与失败原因分开表达', () => {
    const made = toSource({ id: 's1', base_id: 'b1', kind: 'platform' })

    expect(made.lastSyncedAt).toBeNull()
    expect(made.lastError).toBe('')
  })
})
