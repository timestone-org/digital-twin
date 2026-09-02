/**
 * @fileoverview 供应商表单到入参的换算与逐格校验。
 *
 * 守三条后端会 400、但表单上要先拦住的事：嵌入模型没维数、方言体不是 JSON
 * 对象、同一路上模型重名；以及编辑态密钥留空**不带那一格**（带了空串就是把
 * 密钥改成空）。
 */
import { describe, expect, it } from 'vitest'

import {
  emptyForm,
  emptyRow,
  formOf,
  parseExtraBody,
  suggestedRow,
  toCreateInput,
  toUpdateInput,
  validateForm,
} from '@/pages/System/Models/scripts/providerForm'

function filled() {
  const form = emptyForm()
  form.name = '百炼'
  form.baseUrl = 'https://endpoint/compatible-mode/v1'
  form.apiKey = 'sk-x'
  form.models = [
    {
      key: 'r1',
      name: 'qwen-plus',
      kind: 'chat',
      hasVision: true,
      dimensions: '',
    },
    {
      key: 'r2',
      name: 'text-embedding-v3',
      kind: 'embedding',
      hasVision: false,
      dimensions: '1024',
    },
  ]
  return form
}

describe('校验', () => {
  it('一份填全的表单通过', () => {
    expect(validateForm(filled(), false)).toBeNull()
  })

  it('新建态密钥不许空，编辑态可以', () => {
    const form = filled()
    form.apiKey = ''
    expect(validateForm(form, false)).toContain('密钥')
    expect(validateForm(form, true)).toBeNull()
  })

  it.each([
    ['ftp://x/v1', '端点地址'],
    ['endpoint/v1', '端点地址'],
    ['https://', '端点地址'],
  ])('端点 %s 被拒', (baseUrl, expected) => {
    const form = filled()
    form.baseUrl = baseUrl
    expect(validateForm(form, false)).toContain(expected)
  })

  it('嵌入模型没填维数就拦住，并指到那一行', () => {
    const form = filled()
    const row = form.models[1]
    if (row) row.dimensions = ''
    expect(validateForm(form, false)).toContain('第 2 行')
  })

  it('模型重名拦住', () => {
    const form = filled()
    form.models.push({
      key: 'r3',
      name: 'qwen-plus',
      kind: 'chat',
      hasVision: false,
      dimensions: '',
    })
    expect(validateForm(form, false)).toContain('重名')
  })

  it('方言体不是 JSON 对象就拦住', () => {
    const form = filled()
    form.extraBody = '[1, 2]'
    expect(validateForm(form, false)).toContain('JSON 对象')
    form.extraBody = '{not json'
    expect(validateForm(form, false)).toContain('JSON')
  })
})

describe('换算', () => {
  it('新建入参：嵌入带维数、对话不带，接图只对对话模型成立', () => {
    const input = toCreateInput(filled())
    expect(input.models).toEqual([
      { name: 'qwen-plus', kind: 'chat', has_vision: true, dimensions: null },
      {
        name: 'text-embedding-v3',
        kind: 'embedding',
        has_vision: false,
        dimensions: 1024,
      },
    ])
    expect(input.extra_body).toBeNull()
    expect(input.api_key).toBe('sk-x')
  })

  it('更新入参：密钥留空就不带那一格', () => {
    const form = filled()
    form.apiKey = ''
    expect('api_key' in toUpdateInput(form)).toBe(false)
    form.apiKey = 'sk-new'
    expect(toUpdateInput(form).api_key).toBe('sk-new')
  })

  it('方言体原样解成对象', () => {
    expect(parseExtraBody(' {"enable_thinking": true} ')).toEqual({
      enable_thinking: true,
    })
    expect(parseExtraBody('')).toBeNull()
  })

  it('从一路已有的供应商铺表单时密钥留空、方言体格式化回原文', () => {
    const form = formOf({
      id: 'p1',
      name: '百炼',
      base_url: 'https://endpoint/v1',
      api_key_hint: '…1234',
      is_enabled: false,
      extra_body: { enable_thinking: true },
      models: [
        { name: 'e', kind: 'embedding', has_vision: false, dimensions: 8 },
        { name: 'weird', kind: 'audio', has_vision: false, dimensions: null },
      ],
      notes: '备注',
      assigned_purposes: [],
      updated_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })
    expect(form.apiKey).toBe('')
    expect(form.isEnabled).toBe(false)
    expect(JSON.parse(form.extraBody)).toEqual({ enable_thinking: true })
    expect(form.models[0]).toEqual({
      key: expect.any(String),
      name: 'e',
      kind: 'embedding',
      hasVision: false,
      dimensions: '8',
    })
    // 认不出的种类退成对话，而不是让表单里出现一个下拉里没有的值
    expect(form.models[1]?.kind).toBe('chat')
  })

  it('每一行都拿到一把不重复的键，删中间一行不会让其余行错位', () => {
    const rows = [emptyRow(), emptyRow(), suggestedRow('qwen-plus')]
    expect(new Set(rows.map((row) => row.key)).size).toBe(3)
  })

  it('端点自报的名字按名猜种类', () => {
    expect(suggestedRow('text-embedding-v3').kind).toBe('embedding')
    expect(suggestedRow('qwen-vl-max').hasVision).toBe(true)
    expect(suggestedRow('qwen-plus')).toEqual({
      key: expect.any(String),
      name: 'qwen-plus',
      kind: 'chat',
      hasVision: false,
      dimensions: '',
    })
  })
})
