/**
 * @fileoverview 素材面的接口封装：类型目录、直传三步、浏览、搜索、改名与删除。
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

// XHR 没有 `response.ok`，2xx 的区间只能自己写出来
const HTTP_OK = 200
const HTTP_REDIRECT = 300

function onPlatform(options: RequestOptions = {}): RequestOptions {
  return { ...options, baseUrl: PLATFORM_BASE_URL }
}

/** 一次列表查询的筛选与分页。 */
export interface AssetQuery {
  limit?: number | undefined
  offset?: number | undefined
  /** 名字关键词；服务端不区分大小写，`%` 与 `_` 按字面量处理。 */
  q?: string | undefined
}

/** 列素材，新的在前。 */
export async function listAssets(
  kind?: AssetKind,
  options: AssetQuery = {},
): Promise<Asset[]> {
  const rows = await requestData<unknown[]>(
    ASSETS_PATH,
    onPlatform({
      query: {
        kind,
        // ⚠ 空串收成 undefined 而不是原样发：`q=` 会被拼进地址，而服务端把它
        // 当「不筛」，于是同一份结果对应两个不同的 URL
        q: options.q === undefined || options.q === '' ? undefined : options.q,
        limit: options.limit,
        offset: options.offset,
      },
    }),
  )
  return rows.map(toAsset)
}

/**
 * 改素材的显示名。
 * ⚠ 只动库里的名字：对象键由 `(kind, id)` 推导，引用它的大屏一个字都不用改。
 * @param assetId 素材 id
 * @param name 新的显示名
 */
export async function renameAsset(
  assetId: string,
  name: string,
): Promise<Asset> {
  return toAsset(
    await requestData<unknown>(
      `${ASSETS_PATH}/${assetId}`,
      onPlatform({ method: 'PATCH', body: { name } }),
    ),
  )
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

/** 一次上传的进度。总字节为 0 表示浏览器给不出长度。 */
export interface UploadProgress {
  loaded: number
  total: number
}

/** 一次上传的可选项。收成一包是因为逐个铺开会顶破「参数 ≤5」。 */
export interface UploadOptions {
  /** 显示名；留空用文件名。 */
  name?: string | undefined
  /** 取消信号；用户切走时要能中止一个几百 MB 的上传。 */
  signal?: AbortSignal | undefined
  onProgress?: ((progress: UploadProgress) => void) | undefined
}

function abortError(): DOMException {
  return new DOMException('上传已取消', 'AbortError')
}

/**
 * 把一份表单 POST 出去，并把上传进度回传。
 *
 * ⚠ 用 `XMLHttpRequest` 而不是 `fetch`：fetch 至今拿不到**上传**方向的进度，
 * 而这里传的是最大 256MB 的模型——没有进度条时用户只能看着一个不动的按钮，
 * 分不清是在传还是已经卡死。
 * ⚠ XHR 关不掉同源请求的 cookie（`credentials: 'omit'` 只有 fetch 有）。本站
 * 的令牌一律存在 localStorage、全站不种任何 cookie，故这一条没有东西可捎带；
 * 哪天真要用上 cookie，这里必须换回 fetch 或把 `/oss/` 挪到另一个源。
 */
function postForm(
  url: string,
  form: FormData,
  options: UploadOptions,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const { signal, onProgress } = options
    if (signal?.aborted === true) {
      reject(abortError())
      return
    }
    const xhr = new XMLHttpRequest()
    const onAbort = (): void => xhr.abort()
    // ⚠ 无论走哪条出口都要摘掉监听：signal 的寿命由调用方决定，不摘的话
    // 同一个 controller 上会一次次叠加，而叠加起来的只有内存
    const settle = (finish: () => void): void => {
      signal?.removeEventListener('abort', onAbort)
      finish()
    }
    xhr.upload.addEventListener('progress', (event) => {
      onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : 0,
      })
    })
    xhr.addEventListener('load', () =>
      settle(() =>
        xhr.status >= HTTP_OK && xhr.status < HTTP_REDIRECT
          ? resolve()
          : reject(new TransportError(xhr.status, '上传失败，请重试')),
      ),
    )
    xhr.addEventListener('error', () =>
      settle(() =>
        reject(new TransportError(0, '无法连接对象存储，请检查网络')),
      ),
    )
    xhr.addEventListener('abort', () => settle(() => reject(abortError())))
    signal?.addEventListener('abort', onAbort, { once: true })
    xhr.open('POST', url)
    xhr.send(form)
  })
}

/**
 * 浏览器直传：把签好的表单原样 POST 到对象存储。
 *
 * ⚠ **文件字段必须排在最后**：S3 的 POST 语义是「文件之后的字段一律忽略」，
 * 把签名或 key 排到文件后面，存储端读到的就是一份缺字段的表单，回的是一个
 * 含糊的 403，而表单本身看起来完全正确。
 * @param ticket 服务端签发的凭证
 * @param file 用户选的文件
 * @param options 取消信号与进度回调
 */
export function putAssetBytes(
  ticket: UploadTicket,
  file: File,
  options: UploadOptions = {},
): Promise<void> {
  const form = new FormData()
  for (const [key, value] of Object.entries(ticket.fields)) {
    form.append(key, value)
  }
  form.append('file', file)
  return postForm(ticket.url, form, options)
}

/**
 * 走完整三步，回落库后的素材。
 * @param kind 素材类型
 * @param file 用户选的文件
 * @param options 显示名、取消信号与进度回调
 */
export async function uploadAsset(
  kind: AssetKind,
  file: File,
  options: UploadOptions = {},
): Promise<Asset> {
  const ticket = await presignUpload(kind, file)
  await putAssetBytes(ticket, file, options)
  return finalizeUpload(ticket.assetId, options.name?.trim() || file.name)
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
