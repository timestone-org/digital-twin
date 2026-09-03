/**
 * @fileoverview 供应商表单的取值与它到入参的换算：形态、模型行、方言体 JSON、
 * 密钥留空即沿用。
 *
 * ⚠ 要填哪几格由**形态**说了算，而形态清单是后端下发的：靠登录的那些形态
 * 不填端点与密钥，带了后端当场拒。前端另写一份判断的话，表现是「表单里填了、
 * 保存时 422」，而那句话指不回是哪一格多余。
 *
 * ⚠ 校验在这里而不是散在弹窗模板里：嵌入模型没维数、方言体不是 JSON 对象，
 * 后端都会 400，但那时表单已经提交、用户只看到一句「参数校验失败」，
 * 指不回是哪一格。
 */
import type { LlmModelKind, LlmProvider, LlmProviderKind } from '@dt/contracts'
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
  /** 接入形态。⚠ 只在新建时选得了：改形态等于换一路接法。 */
  kind: string
  baseUrl: string
  /** 编辑态留空即沿用旧密钥。 */
  apiKey: string
  isEnabled: boolean
  /** 透传给端点的额外请求体，原文；空串即不加。 */
  extraBody: string
  /** 这一形态的默认推理档位；空串即不配。 */
  defaultEffort: string
  /** 重排走哪一套线形；空串即按这一形态的默认那一路。 */
  rerankDialect: string
  notes: string
  models: ModelRow[]
}

/** 推理档位落在形态配置的哪一格。与后端 `rules.py` 逐字一致。 */
const OPTION_DEFAULT_EFFORT = 'default_effort'
/** 重排线形落在形态配置的哪一格。与后端 `rules.py` 逐字一致。 */
const OPTION_RERANK_DIALECT = 'rerank_dialect'

/** 缺省的形态：不带这一格的旧调用建出来的正是它。 */
export const DEFAULT_KIND = 'openai_compat'

/**
 * 按码取形态；认不出给 null。
 * @param kinds 后端下发的形态清单
 * @param code 形态码
 */
export function kindOf(
  kinds: readonly LlmProviderKind[],
  code: string,
): LlmProviderKind | null {
  return kinds.find((one) => one.code === code) ?? null
}

/** 一路供应商最多登记几个模型，与后端 `MAX_MODELS_PER_PROVIDER` 同值。 */
export const MAX_MODELS = 64

export function emptyForm(kind: string = DEFAULT_KIND): ProviderForm {
  return {
    name: '',
    kind,
    baseUrl: '',
    apiKey: '',
    isEnabled: true,
    extraBody: '',
    defaultEffort: '',
    rerankDialect: '',
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
    kind: provider.kind,
    baseUrl: provider.base_url,
    apiKey: '',
    isEnabled: provider.is_enabled,
    extraBody:
      provider.extra_body === null
        ? ''
        : JSON.stringify(provider.extra_body, null, 2),
    defaultEffort: optionText(provider.options, OPTION_DEFAULT_EFFORT),
    rerankDialect: optionText(provider.options, OPTION_RERANK_DIALECT),
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

/**
 * 读形态配置里的一格；没配或不是字符串给空串。
 * ⚠ 防着读：这几格要原样进请求体，塞个数字进去是后端一条 400。
 * @param options 形态配置
 * @param key 要读哪一格
 */
export function optionText(
  options: Record<string, unknown> | null,
  key: string,
): string {
  const found = options?.[key]
  return typeof found === 'string' ? found : ''
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
 * @param kind 这一路的形态；认不出时只做与形态无关的那几条
 * @param isEdit 编辑态密钥可留空
 */
export function validateForm(
  form: ProviderForm,
  kind: LlmProviderKind | null,
  isEdit: boolean,
): string | null {
  return (
    validateEndpoint(form, kind, isEdit) ??
    validateModels(form.models, kind) ??
    validateExtraBody(form.extraBody)
  )
}

function validateEndpoint(
  form: ProviderForm,
  kind: LlmProviderKind | null,
  isEdit: boolean,
): string | null {
  if (form.name.trim() === '') return '请填供应商名称'
  // ⚠ 靠登录的那些形态整格没有端点：在这里也要求填的话，那一路根本建不出来
  if (kind !== null && !kind.is_endpoint_required) return null
  if (!/^https?:\/\/[^\s/]+/.test(form.baseUrl.trim())) {
    return '端点地址要以 http:// 或 https:// 开头，且带主机名'
  }
  if (!isEdit && form.apiKey.trim() === '') return '请填 API 密钥'
  return null
}

function validateModels(
  rows: ModelRow[],
  kind: LlmProviderKind | null,
): string | null {
  if (rows.length > MAX_MODELS) return `最多登记 ${MAX_MODELS} 个模型`
  const names = new Set<string>()
  for (const [index, row] of rows.entries()) {
    const label = `第 ${index + 1} 行模型`
    if (kind !== null && !kind.model_kinds.includes(row.kind)) {
      return `${label}：「${kind.label}」登记不了这一种`
    }
    const rejected = validateRow(row, label, names)
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
    // ⚠ 只有嵌入模型才有维数：给重排模型带一格，读侧会把它当成嵌入模型
    dimensions: row.kind === 'embedding' ? Number(row.dimensions) : null,
  }))
}

/**
 * 这一形态自己那几格配置；一格都没配就给 null。
 * ⚠ 只带这一形态认得的键：认不得的那一格后端当场拒，而那句话指不回是哪一格。
 * ⚠ 空串即「不配这一格」，不是「配成空串」：后端对空串按未登记的取值拒。
 * @param form 表单取值
 * @param kind 这一路的形态
 */
function optionsOf(
  form: ProviderForm,
  kind: LlmProviderKind | null,
): Record<string, unknown> | null {
  if (kind === null) return null
  const made: Record<string, unknown> = {}
  if (kind.efforts.length > 0 && form.defaultEffort !== '') {
    made[OPTION_DEFAULT_EFFORT] = form.defaultEffort
  }
  if (kind.rerank_dialects.length > 0 && form.rerankDialect !== '') {
    made[OPTION_RERANK_DIALECT] = form.rerankDialect
  }
  return Object.keys(made).length === 0 ? null : made
}

/**
 * 表单 → 新建入参。调用前先过 `validateForm`。
 * ⚠ 靠登录的那些形态**不带**端点与密钥两格：带了后端当场拒。
 * @param form 表单取值
 * @param kind 这一路的形态
 */
export function toCreateInput(
  form: ProviderForm,
  kind: LlmProviderKind | null,
): LlmProviderCreateInput {
  const input: LlmProviderCreateInput = {
    name: form.name.trim(),
    kind: form.kind,
    is_enabled: form.isEnabled,
    options: optionsOf(form, kind),
    models: modelInputs(form.models),
    notes: form.notes.trim(),
  }
  if (kind !== null && !kind.is_endpoint_required) return input
  input.base_url = form.baseUrl.trim()
  input.api_key = form.apiKey.trim()
  input.extra_body = parseExtraBody(form.extraBody)
  return input
}

/**
 * 表单 → 更新入参。密钥留空即不带那一格，后端沿用旧的。
 * @param form 表单取值
 * @param kind 这一路的形态
 */
export function toUpdateInput(
  form: ProviderForm,
  kind: LlmProviderKind | null,
): LlmProviderUpdateInput {
  const input: LlmProviderUpdateInput = {
    name: form.name.trim(),
    is_enabled: form.isEnabled,
    options: optionsOf(form, kind),
    models: modelInputs(form.models),
    notes: form.notes.trim(),
  }
  if (kind !== null && !kind.is_endpoint_required) return input
  input.base_url = form.baseUrl.trim()
  input.extra_body = parseExtraBody(form.extraBody)
  if (form.apiKey.trim() !== '') input.api_key = form.apiKey.trim()
  return input
}
