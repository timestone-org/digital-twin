/** @fileoverview MCP 确认展示可信完整参数；关闭、停止、卸载拒绝，重复确认只有一次提交。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMcpWritePrepare } from '@dt/contracts'

import * as api from '@/api/assistant'
import AiMcpWriteConfirmHost from '@/components/ai/AiMcpWriteConfirmHost.vue'
import { runMcpWrite } from '@/features/ai/mcpWriteBridge'

const PREPARED: AssistantMcpWritePrepare = {
  call_id: 'w1',
  tool_name: 'mcp.test.write',
  arguments: {
    target: '测试对象',
    value: 123,
    nested: { label: '<script>not executable</script>' },
  },
  target: '测试对象/具体范围',
  impact: '将改写测试执行器数据；不是草稿保存，不连接真实设备',
  ticket: 'secret-ticket',
  expires_at: '2026-10-03T16:00:00.000Z',
}
const CALL = {
  call_id: 'w1',
  name: PREPARED.tool_name,
  arguments: { hidden: '模型伪造参数' },
}
let wrapper: ReturnType<typeof mount<typeof AiMcpWriteConfirmHost>> | null =
  null

function deferred<T>() {
  let resolve: ((value: T) => void) | null = null
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return {
    promise,
    resolve(value: T) {
      resolve?.(value)
    },
  }
}

async function open(signal?: AbortSignal) {
  wrapper = mount(AiMcpWriteConfirmHost, { attachTo: document.body })
  const result = runMcpWrite('s1', CALL, signal)
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
  )
  return { result }
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll('button')).find(
    (one) => one.textContent?.trim() === text,
  )
  if (found === undefined) throw new Error(`缺少按钮：${text}`)
  return found
}

beforeEach(() => {
  vi.spyOn(api, 'prepareMcpWrite').mockResolvedValue(PREPARED)
  vi.spyOn(api, 'decideMcpWrite').mockResolvedValue({
    call_id: 'w1',
    output: { changed: 1 },
    error: null,
  })
})
afterEach(async () => {
  wrapper?.unmount()
  wrapper = null
  await flushPromises()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('逐次MCP写确认界面', () => {
  it('完整显示服务端工具、具体目标、全部参数和影响，文本安全转义且不显示票据', async () => {
    const { result } = await open()
    expect(document.body.textContent).toContain(PREPARED.tool_name)
    expect(document.body.textContent).toContain(PREPARED.target)
    expect(document.body.textContent).toContain(PREPARED.impact)
    expect(
      document.querySelector('[data-test="mcp-arguments"]')?.textContent,
    ).toBe(JSON.stringify(PREPARED.arguments, null, 2))
    expect(document.body.textContent).not.toContain('secret-ticket')
    expect(document.body.textContent).not.toContain('模型伪造参数')
    expect(document.querySelector('script')).toBeNull()
    expect(api.decideMcpWrite).not.toHaveBeenCalled()
    button('取消，不执行').click()
    await result
  })

  it('明确确认及重复点击只提交一次，在途控件不可再次提交', async () => {
    const response = deferred<Awaited<ReturnType<typeof api.decideMcpWrite>>>()
    vi.mocked(api.decideMcpWrite).mockReturnValue(response.promise)
    const { result } = await open()
    const confirm = button('确认并执行一次')
    confirm.click()
    confirm.click()
    await flushPromises()
    expect(api.decideMcpWrite).toHaveBeenCalledExactlyOnceWith('s1', 'w1', {
      ticket: 'secret-ticket',
      confirm: true,
    })
    expect(confirm.disabled).toBe(true)
    expect(button('取消，不执行').disabled).toBe(true)
    expect(document.body.textContent).toContain('正在提交决定并等待结果')
    response.resolve({ call_id: 'w1', output: { changed: 1 }, error: null })
    await expect(result).resolves.toEqual({ changed: 1 })
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each(['取消，不执行', '关闭', 'Escape'])(
    '%s 只提交拒绝决定',
    async (method) => {
      const { result } = await open()
      if (method === 'Escape') {
        document
          .querySelector('[role="dialog"]')
          ?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
          )
      } else if (method === '关闭') {
        document
          .querySelector<HTMLButtonElement>('button[aria-label="关闭"]')
          ?.click()
      } else button(method).click()
      await result
      expect(api.decideMcpWrite).toHaveBeenCalledExactlyOnceWith('s1', 'w1', {
        ticket: 'secret-ticket',
        confirm: false,
      })
    },
  )

  it('停止对话关闭待确认并拒绝票据', async () => {
    const controller = new AbortController()
    const { result } = await open(controller.signal)
    controller.abort()
    await result
    await flushPromises()
    expect(api.decideMcpWrite).toHaveBeenCalledExactlyOnceWith('s1', 'w1', {
      ticket: 'secret-ticket',
      confirm: false,
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('宿主卸载仍提交拒绝决定而不使用已中止信号', async () => {
    const { result } = await open()
    wrapper?.unmount()
    wrapper = null
    await result
    expect(api.decideMcpWrite).toHaveBeenCalledExactlyOnceWith('s1', 'w1', {
      ticket: 'secret-ticket',
      confirm: false,
    })
  })

  it('确认执行后卸载保留实际返回结果，不改成取消', async () => {
    const response = deferred<Awaited<ReturnType<typeof api.decideMcpWrite>>>()
    vi.mocked(api.decideMcpWrite).mockReturnValue(response.promise)
    const { result } = await open()
    button('确认并执行一次').click()
    await vi.waitFor(() => expect(api.decideMcpWrite).toHaveBeenCalled())
    wrapper?.unmount()
    wrapper = null
    response.resolve({
      call_id: 'w1',
      output: { actuallyExecuted: true },
      error: null,
    })
    await expect(result).resolves.toEqual({ actuallyExecuted: true })
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })

  it('实际失败保持错误提示但不提供重新执行按钮', async () => {
    vi.mocked(api.decideMcpWrite).mockResolvedValue({
      call_id: 'w1',
      output: null,
      error: '执行器拒绝测试写入',
    })
    const { result } = await open()
    const failed = expect(result).rejects.toThrow('执行器拒绝测试写入')
    button('确认并执行一次').click()
    await failed
    await flushPromises()
    expect(document.body.textContent).toContain('执行器拒绝测试写入')
    expect(document.body.textContent).not.toContain('确认并执行一次')
    expect(document.body.textContent).toContain('不要重复提交')
    button('关闭').click()
    await flushPromises()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(api.decideMcpWrite).toHaveBeenCalledTimes(1)
  })
})
