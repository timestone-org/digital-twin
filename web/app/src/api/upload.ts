/**
 * @fileoverview 浏览器直传的公共件：进度、取消、把一份表单 POST 出去。
 *
 * 两个消费方：素材库与知识库——两边都是「签一张表单，浏览器把字节直接送进
 * 对象存储」，而那段 XHR 的取消与进度处理是同一份。
 *
 * ⚠ 字节从不经过本站 API：让一个几百 MB 的文件穿过 API 进程，会把一个 worker
 * 占住几十秒（ADR-0015）。
 */
import { TransportError } from './client'

// XHR 没有 `response.ok`，2xx 的区间只能自己写出来
const HTTP_OK = 200
const HTTP_REDIRECT = 300

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
 * 浏览器直传：把签好的表单原样 POST 出去。
 *
 * ⚠ **文件字段必须排在最后**：S3 的 POST 语义是「文件之后的字段一律忽略」，
 * 把签名或 key 排到文件后面，存储端读到的就是一份缺字段的表单，回的是一个
 * 含糊的 403，而表单本身看起来完全正确。
 * @param url 存储端地址
 * @param fields 签好的表单字段，原样按序写进去
 * @param file 用户选的文件
 * @param options 取消信号与进度回调
 */
export function postUploadForm(
  url: string,
  fields: Record<string, string>,
  file: File,
  options: UploadOptions = {},
): Promise<void> {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value)
  }
  form.append('file', file)
  return postForm(url, form, options)
}
