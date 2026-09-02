/**
 * @fileoverview 供应商表单的取值与它到入参的换算：模型行、方言体 JSON、密钥留空即沿用。
 *
 * ⚠ 校验在这里而不是散在弹窗模板里：嵌入模型没维数、方言体不是 JSON 对象，
 * 后端都会 400，但那时表单已经提交、用户只看到一句「参数校验失败」，
 * 指不回是哪一格。
 */
import type { LlmModelKind, LlmProvider } from '@dt/contracts'
import { LLM_MODEL_KINDS } from '@dt/contracts'

import type {
  LlmModelInput,
  LlmProviderCreateInput,
  LlmProviderUpdateInput,
} from '@/api/llmProviders'

/** 表单里的一行模型。维数按字符串收，空串即「没填」。 */
export interface ModelRow {
  /** 只给列表渲染用的稳定键，不进接口：按索引当键会在删中间一行时把其余行的本地状态串行 */
  key: string
  name: string
  kind: LlmModelKind
  hasVision: boolean
  dimensions: string
}

export interface ProviderForm {
  name: string
  baseUrl: string
  /** 编辑态留空即沿用旧密钥。 */
  apiKey: string
  isEnabled: boolean
  /** 透传给端点的额外请求体，原文；空串即不加。 */
  extraBody: string
  notes: string
  models: ModelRow[]
}

/** 一路供应商最多登记几个模型，与后端 `MAX_MODELS_PER_PROVIDER` 同值。 */
export const MAX_MODELS = 64

export function emptyForm(): ProviderForm {
  return {
    name: '',
    baseUrl: '',
    apiKey: '',
    isEnabled: true,
    extraBody: '',
    notes: '',
    models: [],
  }
}

let rowSeq = 0

/** 下一把行键。只求这一次会话里不重复，不求跨刷新稳定。 */
function nextRowKey(): string {
  rowSeq += 1
  return `row-${rowSeq}`
}

export function emptyRow(kind: LlmModelKind = 'chat'): ModelRow {
  return { key: nextRowKey(), name: '', kind, hasVision: false, dimensions: '' }
}

/**
 * 把一路已有的供应商铺进表单。密钥格留空——库里只有密文，取不回来。
 * @param provider 要编辑的那一路
 */
export function formOf(provider: LlmProvider): ProviderForm {
  return {
    name: provider.name,
    baseUrl: provider.base_url,
    apiKey: '',
    isEnabled: provider.is_enabled,
    extraBody:
      provider.extra_body === null
        ? ''
        : JSON.stringify(provider.extra_body, null, 2),
    notes: provider.notes,
    models: provider.models.map((one) => ({
      key: nextRowKey(),
      name: one.name,
      kind: isModelKind(one.kind) ? one.kind : 'chat',
      hasVision: one.has_vision,
      dimensions: one.dimensions === null ? '' : String(one.dimensions),
    })),
  }
}

/**
 * 端点自报的模型名猜一行：名字里带 embed 的按嵌入模型起，维数留给人填。
 * @param name 端点自报的模型代号
 */
export function suggestedRow(name: string): ModelRow {
  const isEmbedding = /embed/i.test(name)
  return {
    key: nextRowKey(),
    name,
    kind: isEmbedding ? 'embedding' : 'chat',
    hasVision: !isEmbedding && /vision|vl|omni|4o/i.test(name),
    dimensions: '',
  }
}

export function isModelKind(value: string): value is LlmModelKind {
  return (LLM_MODEL_KINDS as readonly string[]).includes(value)
}

/**
 * 解方言体。空串给 null；不是 JSON 对象就抛一句能标到那一格的话。
 * @param text 表单原文
 */
export function parseExtraBody(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('额外请求体不是合法的 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('额外请求体必须是一个 JSON 对象')
  }
  return { ...parsed }
}

/**
 * 逐格校验；第一条错就返回，给人一次改一格。
 * @param form 表单取值
 * @param isEdit 编辑态密钥可留空
 */
export function validateForm(
  form: ProviderForm,
  isEdit: boolean,
): string | null {
  return (
    validateEndpoint(form, isEdit) ??
    validateModels(form.models) ??
    validateExtraBody(form.extraBody)
  )
}

function validateEndpoint(form: ProviderForm, isEdit: boolean): string | null {
  if (form.name.trim() === '') return '请填供应商名称'
  if (!/^https?:\/\/[^\s/]+/.test(form.baseUrl.trim())) {
    return '端点地址要以 http:// 或 https:// 开头，且带主机名'
  }
  if (!isEdit && form.apiKey.trim() === '') return '请填 API 密钥'
  return null
}

function validateModels(rows: ModelRow[]): string | null {
  if (rows.length > MAX_MODELS) return `最多登记 ${MAX_MODELS} 个模型`
  const names = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const rejected = validateRow(row, `第 ${index + 1} 行模型`, names)
    if (rejected !== null) return rejected
    names.add(row.name.trim())
  }
  return null
}

function validateRow(
  row: ModelRow,
  label: string,
  seen: ReadonlySet<string>,
): string | null {
  if (row.name.trim() === '') return `${label}没填代号`
  if (seen.has(row.name.trim())) return `${label}与前面重名`
  if (row.kind !== 'embedding') return null
  const dims = Number(row.dimensions)
  if (!Number.isInteger(dims) || dims <= 0) {
    return `${label}是嵌入模型，要填一个正整数的向量维数`
  }
  return null
}

function validateExtraBody(text: string): string | null {
  try {
    parseExtraBody(text)
  } catch (caught) {
    return caught instanceof Error ? caught.message : '额外请求体不合法'
  }
  return null
}

function modelInputs(rows: ModelRow[]): LlmModelInput[] {
  return rows.map((row) => ({
    name: row.name.trim(),
    kind: row.kind,
    has_vision: row.kind === 'chat' && row.hasVision,
    dimensions: row.kind === 'embedding' ? Number(row.dimensions) : null,
  }))
}

/**
 * 表单 → 新建入参。调用前先过 `validateForm`。
 * @param form 表单取值
 */
export function toCreateInput(form: ProviderForm): LlmProviderCreateInput {
  return {
    name: form.name.trim(),
    base_url: form.baseUrl.trim(),
    api_key: form.apiKey.trim(),
    is_enabled: form.isEnabled,
    extra_body: parseExtraBody(form.extraBody),
    models: modelInputs(form.models),
    notes: form.notes.trim(),
  }
}

/**
 * 表单 → 更新入参。密钥留空即不带那一格，后端沿用旧的。
 * @param form 表单取值
 */
export function toUpdateInput(form: ProviderForm): LlmProviderUpdateInput {
  const input: LlmProviderUpdateInput = {
    name: form.name.trim(),
    base_url: form.baseUrl.trim(),
    is_enabled: form.isEnabled,
    extra_body: parseExtraBody(form.extraBody),
    models: modelInputs(form.models),
    notes: form.notes.trim(),
  }
  if (form.apiKey.trim() !== '') input.api_key = form.apiKey.trim()
  return input
}
