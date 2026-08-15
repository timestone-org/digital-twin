/**
 * @fileoverview 素材面的接口封装：类型目录、直传三步、浏览与删除。
 *
 * ⚠ 直传的第二步**不经过本站 API**：浏览器拿着签好的表单直接 POST 到对象存储。
 * 让字节穿过 API 进程的话，一个 200MB 的模型会把一个 worker 占住几十秒。
 * ⚠ 落库的一律是 `asset:<uuid>` 引用，不是 URL：部署地址一换、桶名一换，
 * 存量配置里那条链接就 404，而没有任何一处会报错。
 * ⚠ 路径写**相对 platform 前缀**的那一段，前缀由 `onPlatform` 铺进 `baseUrl`：
 * 把整条 `/api/v1/platform/...` 当 path 传，客户端会再拼一次缺省的 auth 前缀，
 * 拼出 `/api/v1/auth/api/v1/platform/...`——边缘照样有人接（auth-server），
 * 于是拿回来的是一个 403 的 HTML 页，前端只说得出「服务端响应格式异常」。
 */
import type { AssetKind } from '@dt/contracts'

import { ASSET_BASE_URL, PLATFORM_BASE_URL } from '@/config/app'
import { TransportError, request, requestData } from './client'
import type { RequestOptions } from './client'
import type { Asset, AssetKindSpec, UploadTicket } from './assetsWire'
import { toAsset, toAssetKindSpec, toUploadTicket } from './assetsWire'

export type { Asset, AssetKindSpec, UploadTicket } from './assetsWire'

/** 没等到上传的字节（领域 15）。⚠ 按码分支，不按 message。 */
export const ASSET_UPLOAD_MISSING_CODE = 41505

const ASSETS_PATH = '/assets'

function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

/** 列素材，新的在前。 */
export async function listAssets(
  kind?: AssetKind,
  options: { limit?: number; offset?: number } = {},
): Promise<Asset[]> {
  const rows = await requestData<unknown[]>(
    ASSETS_PATH,
    onPlatform({
      query: { kind, limit: options.limit, offset: options.offset },
    }),
  )
  return rows.map(toAsset)
}

/** 可上传的类型与各自的类型/大小闸。 */
export async function listAssetKinds(): Promise<AssetKindSpec[]> {
  const rows = await requestData<unknown[]>(
    `${ASSETS_PATH}/kinds`,
    onPlatform(),
  )
  return rows.map(toAssetKindSpec)
}

/** 取一个素材。 */
export async function getAsset(assetId: string): Promise<Asset> {
  return toAsset(
    await requestData<unknown>(`${ASSETS_PATH}/${assetId}`, onPlatform()),
  )
}

/** 删素材。字节与行一起走，删不存在的素材不是错误。 */
export async function deleteAsset(assetId: string): Promise<void> {
  await request<null>(
    `${ASSETS_PATH}/${assetId}`,
    onPlatform({ method: 'DELETE' }),
  )
}

/** 申请一张直传凭证。**这一步不落行**，没传成不会留下半条记录。 */
export async function presignUpload(
  kind: AssetKind,
  file: File,
): Promise<UploadTicket> {
  return toUploadTicket(
    await requestData<unknown>(
      `${ASSETS_PATH}:presign-upload`,
      onPlatform({
        method: 'POST',
        body: {
          kind,
          content_type: contentTypeOf(file),
          size_bytes: file.size,
        },
      }),
    ),
  )
}

/** 确认字节到了：搬进正式前缀并落行。重复调用返回同一个素材。 */
export async function finalizeUpload(
  assetId: string,
  name: string,
): Promise<Asset> {
  return toAsset(
    await requestData<unknown>(
      `${ASSETS_PATH}/${assetId}:finalize`,
      onPlatform({ method: 'POST', body: { name } }),
    ),
  )
}

/**
 * 浏览器直传：把签好的表单原样 POST 到对象存储。
 *
 * ⚠ **文件字段必须排在最后**：S3 的 POST 语义是「文件之后的字段一律忽略」，
 * 把签名或 key 排到文件后面，存储端读到的就是一份缺字段的表单，回的是一个
 * 含糊的 403，而表单本身看起来完全正确。
 * ⚠ 不带凭据：这是跨到对象存储的请求，带上会话 cookie 既无用又是一次泄露。
 * @param ticket 服务端签发的凭证
 * @param file 用户选的文件
 * @param signal 取消信号；用户切走时要能中止一个几百 MB 的上传
 */
export async function putAssetBytes(
  ticket: UploadTicket,
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData()
  for (const [key, value] of Object.entries(ticket.fields)) {
    form.append(key, value)
  }
  form.append('file', file)
  // ⚠ signal 只在给了时才铺进去：`exactOptionalPropertyTypes` 下显式的
  // `signal: undefined` 与「没有这个键」不是一回事
  const init: RequestInit = {
    method: 'POST',
    body: form,
    credentials: 'omit',
    ...(signal === undefined ? {} : { signal }),
  }
  const response = await fetch(ticket.url, init)
  if (!response.ok) {
    throw new TransportError(response.status, '上传失败，请重试')
  }
}

/**
 * 走完整三步，回落库后的素材。
 * @param kind 素材类型
 * @param file 用户选的文件
 * @param name 显示名；留空用文件名
 * @param signal 取消信号
 */
export async function uploadAsset(
  kind: AssetKind,
  file: File,
  name?: string,
  signal?: AbortSignal,
): Promise<Asset> {
  const ticket = await presignUpload(kind, file)
  await putAssetBytes(ticket, file, signal)
  return finalizeUpload(ticket.assetId, name?.trim() || file.name)
}

/** 素材字节的取回前缀，给 `assetUrl` 用。 */
export function assetBaseUrl(): string {
  return ASSET_BASE_URL
}

/**
 * 文件的内容类型。
 * ⚠ 不少系统对 .glb 给不出类型，浏览器于是填空串；服务端的白名单收了
 * `application/octet-stream` 这一档，这里补上它而不是让请求以空串被 422 拒掉。
 */
function contentTypeOf(file: File): string {
  return file.type === '' ? 'application/octet-stream' : file.type
}
