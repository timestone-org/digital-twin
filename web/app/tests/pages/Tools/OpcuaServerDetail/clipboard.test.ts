/**
 * @fileoverview 复制到剪贴板的两条路。
 *
 * ⚠ 退路那条是给现场用的：本平台按内网 IP 走纯 HTTP，那里
 * `navigator.clipboard` 是 undefined。开发机（localhost 是安全上下文）
 * 永远走不到它——没有这几条用例，退路坏了也没人知道。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from '@/pages/Tools/OpcuaServerDetail/clipboard'

/** 装一个假的 clipboard，返回还原函数。传 undefined 模拟非安全上下文。 */
function stubClipboard(api: { writeText: () => Promise<void> } | undefined): {
  restore: () => void
} {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', {
    value: api,
    configurable: true,
  })
  return {
    restore: () => {
      if (original === undefined) {
        Reflect.deleteProperty(navigator, 'clipboard')
      } else {
        Object.defineProperty(navigator, 'clipboard', original)
      }
    },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('安全上下文里', () => {
  it('走 navigator.clipboard 并报成功', async () => {
    const writeText = vi.fn<() => Promise<void>>().mockResolvedValue()
    const stub = stubClipboard({ writeText })
    try {
      expect(await copyText('ns=2;s=T1')).toBe(true)
      expect(writeText).toHaveBeenCalledWith('ns=2;s=T1')
    } finally {
      stub.restore()
    }
  })

  it('用户拒绝授权时落到退路，而不是直接报失败', async () => {
    const stub = stubClipboard({
      writeText: () => Promise.reject(new Error('denied')),
    })
    const exec = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', {
      value: exec,
      configurable: true,
    })
    try {
      expect(await copyText('x')).toBe(true)
      expect(exec).toHaveBeenCalledWith('copy')
    } finally {
      stub.restore()
    }
  })
})

describe('⚠ 纯 HTTP 的现场（navigator.clipboard 不存在）', () => {
  it('用离屏 textarea + execCommand 完成复制', async () => {
    const stub = stubClipboard(undefined)
    let seen: string | null = null
    Object.defineProperty(document, 'execCommand', {
      value: () => {
        seen =
          document.body.querySelector('textarea')?.value ??
          '（没找到 textarea）'
        return true
      },
      configurable: true,
    })
    try {
      expect(await copyText('抄这个')).toBe(true)
      expect(seen).toBe('抄这个')
    } finally {
      stub.restore()
    }
  })

  it('复制完把 textarea 收走，不在页面上留残渣', async () => {
    const stub = stubClipboard(undefined)
    Object.defineProperty(document, 'execCommand', {
      value: () => true,
      configurable: true,
    })
    try {
      await copyText('x')
      expect(document.body.querySelector('textarea')).toBeNull()
    } finally {
      stub.restore()
    }
  })

  it('execCommand 抛异常时报失败，让调用方提示手动复制', async () => {
    const stub = stubClipboard(undefined)
    Object.defineProperty(document, 'execCommand', {
      value: () => {
        throw new Error('nope')
      },
      configurable: true,
    })
    try {
      expect(await copyText('x')).toBe(false)
      // 抛了也要收走
      expect(document.body.querySelector('textarea')).toBeNull()
    } finally {
      stub.restore()
    }
  })

  it('execCommand 返回 false 时如实报失败，不谎报已复制', async () => {
    const stub = stubClipboard(undefined)
    Object.defineProperty(document, 'execCommand', {
      value: () => false,
      configurable: true,
    })
    try {
      expect(await copyText('x')).toBe(false)
    } finally {
      stub.restore()
    }
  })
})
