/**
 * @fileoverview 契约：直传那一步的表单顺序、进度回传与取消。
 *
 * ⚠ 表单顺序不是风格问题：S3 的 POST 语义是「文件之后的字段一律忽略」，把签名
 * 或 key 排到文件后面，存储端读到的是一份缺字段的表单，回的是一个含糊的 403，
 * 而表单本身看起来完全正确。
 * ⚠ 走 XHR 而不是 fetch 是为了拿**上传方向**的进度——fetch 至今给不出它，而这里
 * 传的是最大 256MB 的模型，没有进度就只剩一个不动的按钮。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { putAssetBytes } from '@/api/assets'
import type { UploadTicket } from '@/api/assets'

const TICKET: UploadTicket = {
  assetId: 'a1',
  url: '/oss/',
  fields: { key: 'staging/model/a1', policy: 'p', signature: 's' },
  expiresSeconds: 900,
}

const FILE = new File(['glTF-ish'], 'a.glb', { type: 'model/gltf-binary' })

interface Listener {
  (event: { loaded: number; total: number; lengthComputable: boolean }): void
}

/** 一个只记账、不发请求的 XHR，够跑完整条直传路径。 */
class FakeXhr {
  static last: FakeXhr | null = null

  status = 200
  aborted = false
  sent: FormData | null = null
  opened: [string, string] | null = null
  readonly upload = { addEventListener: this.on.bind(this, 'upload:progress') }
  private readonly handlers = new Map<string, Listener[]>()

  constructor() {
    FakeXhr.last = this
  }

  private on(prefix: string, name: string, fn: Listener): void {
    const key = prefix.includes(':') ? prefix : `${prefix}:${name}`
    const list = this.handlers.get(key) ?? []
    list.push(fn)
    this.handlers.set(key, list)
  }

  addEventListener(name: string, fn: Listener): void {
    this.on('self', name, fn)
  }

  removeEventListener(): void {
    // 用例不校验摘监听，摘不摘都不影响下面的断言
  }

  open(method: string, url: string): void {
    this.opened = [method, url]
  }

  send(body: FormData): void {
    this.sent = body
  }

  abort(): void {
    this.aborted = true
    this.fire('self:abort')
  }

  /** 让外部驱动这次请求走到某个事件上。 */
  fire(
    key: string,
    event: { loaded: number; total: number; lengthComputable: boolean } = {
      loaded: 0,
      total: 0,
      lengthComputable: false,
    },
  ): void {
    for (const fn of this.handlers.get(key) ?? []) fn(event)
  }
}

beforeEach(() => {
  FakeXhr.last = null
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function xhr(): FakeXhr {
  const found = FakeXhr.last
  if (found === null) throw new Error('没有发出请求')
  return found
}

describe('直传', () => {
  it('文件字段排在最后，凭证字段原样在前', async () => {
    const done = putAssetBytes(TICKET, FILE)
    const keys = [...(xhr().sent?.keys() ?? [])]
    xhr().fire('self:load')
    await done

    expect(keys).toEqual(['key', 'policy', 'signature', 'file'])
  })

  it('POST 到凭证给的地址', async () => {
    const done = putAssetBytes(TICKET, FILE)
    xhr().fire('self:load')
    await done

    expect(xhr().opened).toEqual(['POST', '/oss/'])
  })

  it('进度按已传字节回传；服务端没给长度时总数是 0', async () => {
    const seen: Array<{ loaded: number; total: number }> = []
    const done = putAssetBytes(TICKET, FILE, {
      onProgress: (progress) => seen.push(progress),
    })
    xhr().fire('upload:progress', {
      loaded: 40,
      total: 100,
      lengthComputable: true,
    })
    xhr().fire('upload:progress', {
      loaded: 80,
      total: 100,
      lengthComputable: false,
    })
    xhr().fire('self:load')
    await done

    expect(seen).toEqual([
      { loaded: 40, total: 100 },
      { loaded: 80, total: 0 },
    ])
  })

  it('非 2xx 一律当失败，不许静默当成传成了', async () => {
    const done = putAssetBytes(TICKET, FILE)
    xhr().status = 403
    xhr().fire('self:load')

    await expect(done).rejects.toThrow('上传失败')
  })

  it('网络断了说的是连不上，而不是「上传失败」', async () => {
    const done = putAssetBytes(TICKET, FILE)
    xhr().fire('self:error')

    await expect(done).rejects.toThrow('无法连接对象存储')
  })

  it('取消信号一响就中止在途请求', async () => {
    const controller = new AbortController()
    const done = putAssetBytes(TICKET, FILE, { signal: controller.signal })
    controller.abort()

    await expect(done).rejects.toThrow('上传已取消')
    expect(xhr().aborted).toBe(true)
  })

  it('信号在开传之前就已经中止的话，一个请求都不发', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      putAssetBytes(TICKET, FILE, { signal: controller.signal }),
    ).rejects.toThrow('上传已取消')
    expect(FakeXhr.last).toBeNull()
  })
})
