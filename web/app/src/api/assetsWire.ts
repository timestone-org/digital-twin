/**
 * @fileoverview 素材出参的线形（后端 snake_case）与它到载荷（camelCase）的映射。
 *
 * ⚠ 逐字段窄化，不写 `as`：后端与前端各改各的时，断言会让错形状一路流进界面，
 * 最后崩在某个深层组件里，而不是在这里说「形状不对」。
 */
import type { AssetKind, DerivedModelVariant } from '@dt/contracts'
import { ASSET_KINDS, DERIVED_MODEL_VARIANTS } from '@dt/contracts'

import { TransportError } from './client'

/** 一档压缩产物的状态。⚠ 与服务端 `VARIANT_STATUSES` 逐字一致。 */
export const VARIANT_STATUSES = ['pending', 'ready', 'failed'] as const
export type VariantStatus = (typeof VARIANT_STATUSES)[number]

/** 一个模型素材的一档压缩产物。 */
export interface AssetVariant {
  variant: DerivedModelVariant
  label: string
  hint: string
  status: VariantStatus
  /** 未压成时为 null，不是 0——0 会在界面上显示成「0 B」，那是个假事实。 */
  sizeBytes: number | null
  checksum: string | null
  /** 失败原因；其余状态是空串。 */
  error: string
}

/** 一个素材。 */
export interface Asset {
  id: string
  /** 落库用的引用串 `asset:<uuid>`。 */
  ref: string
  kind: AssetKind
  name: string
  contentType: string
  sizeBytes: number
  checksum: string
  createdAt: string
  createdBy: string
  /** 压缩档。⚠ 只有模型才有，图片与图标一律空数组。 */
  variants: AssetVariant[]
}

/** 一类素材的登记信息，给文件选择器做 accept 与预检。 */
export interface AssetKindSpec {
  kind: AssetKind
  label: string
  contentTypes: string[]
  maxBytes: number
}

/** 一次直传的表单凭证。 */
export interface UploadTicket {
  assetId: string
  url: string
  /** ⚠ 必须原样按序写进表单，且**文件字段排在最后**（见 uploadAsset）。 */
  fields: Record<string, string>
  expiresSeconds: number
}

/** 一个素材的线形。⚠ 键名以 openapi 的 `AssetOut` 为准，由契约用例钉住。 */
export interface AssetWire {
  id: string
  ref: string
  kind: string
  name: string
  content_type: string
  size_bytes: number
  checksum: string
  created_at: string
  created_by: string
  variants?: unknown
}

/** 一档压缩产物的线形。⚠ 键名以 openapi 的 `AssetVariantOut` 为准。 */
export interface AssetVariantWire {
  variant: string
  label: string
  hint: string
  status: string
  size_bytes: number | null
  checksum: string | null
  error: string
}

/** 一类素材登记的线形。 */
export interface AssetKindWire {
  kind: string
  label: string
  content_types: string[]
  max_bytes: number
}

/** 一次直传凭证的线形。 */
export interface UploadTicketWire {
  asset_id: string
  url: string
  fields: Record<string, string>
  expires_seconds: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 后端给的类型串收窄成闭合联合；不认识的一律拒。 */
function assetKind(value: unknown): AssetKind {
  const found = ASSET_KINDS.find((kind) => kind === value)
  if (found === undefined) {
    // ⚠ 不静默回落到某一类：回落的那一类会用错误的对象键去取回，
    // 表现是 404 而不是「这是个没见过的素材类型」
    throw new TransportError(0, `未知的素材类型：${text(value)}`)
  }
  return found
}

/** 后端给的档名收窄成闭合联合；不认识的一律拒。 */
function variantName(value: unknown): DerivedModelVariant {
  const found = DERIVED_MODEL_VARIANTS.find((name) => name === value)
  if (found === undefined) {
    throw new TransportError(0, `未知的压缩档：${text(value)}`)
  }
  return found
}

/** 状态同理收窄；不认识的当成待压缩，界面上至少不会显示成「已就绪」。 */
function variantStatus(value: unknown): VariantStatus {
  return VARIANT_STATUSES.find((name) => name === value) ?? 'pending'
}

/** 线形 → 一档。⚠ 大小与校验和保留 null，不折成 0/空串。 */
function toAssetVariant(raw: unknown): AssetVariant {
  if (!isRecord(raw)) throw new TransportError(0, '压缩档数据格式不对')
  return {
    variant: variantName(raw.variant),
    label: text(raw.label),
    hint: text(raw.hint),
    status: variantStatus(raw.status),
    sizeBytes: typeof raw.size_bytes === 'number' ? raw.size_bytes : null,
    checksum: typeof raw.checksum === 'string' ? raw.checksum : null,
    error: text(raw.error),
  }
}

/** 线形 → 载荷。 */
export function toAsset(raw: unknown): Asset {
  const wire = isRecord(raw) ? (raw as unknown as AssetWire) : null
  if (wire === null) throw new TransportError(0, '素材数据格式不对')
  return {
    id: text(wire.id),
    ref: text(wire.ref),
    kind: assetKind(wire.kind),
    name: text(wire.name),
    contentType: text(wire.content_type),
    sizeBytes: count(wire.size_bytes),
    checksum: text(wire.checksum),
    createdAt: text(wire.created_at),
    createdBy: text(wire.created_by),
    variants: Array.isArray(wire.variants)
      ? wire.variants.map(toAssetVariant)
      : [],
  }
}

/** 线形 → 类型登记。 */
export function toAssetKindSpec(raw: unknown): AssetKindSpec {
  if (!isRecord(raw)) throw new TransportError(0, '素材类型数据格式不对')
  const types = raw.content_types
  return {
    kind: assetKind(raw.kind),
    label: text(raw.label),
    contentTypes: Array.isArray(types) ? types.map(text) : [],
    maxBytes: count(raw.max_bytes),
  }
}

/** 线形 → 直传凭证。 */
export function toUploadTicket(raw: unknown): UploadTicket {
  if (!isRecord(raw)) throw new TransportError(0, '直传凭证格式不对')
  const fields = raw.fields
  return {
    assetId: text(raw.asset_id),
    url: text(raw.url),
    fields: isRecord(fields)
      ? Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [key, text(value)]),
        )
      : {},
    expiresSeconds: count(raw.expires_seconds),
  }
}
