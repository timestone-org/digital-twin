/**
 * @fileoverview 守增量解帧：网络分块会在任意位置切断一帧。
 *
 * 每块各解各的写法在本地永远是绿的（本地一帧一块），只有在网络慢、块被切碎时
 * 才会丢步——而丢的那一步在界面上表现为「AI 做了什么没显示」。
 */
import { describe, expect, it } from 'vitest'
import { createFrameReader } from '@/features/ai/sseFrames'

function frame(name: string, body: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(body)}\n\n`
}

describe('增量解帧', () => {
  it('一块里读全的帧当场交出来', () => {
    const reader = createFrameReader()
    const found = reader.push(frame('step', { title: '想了想' }))
    expect(found).toEqual([{ name: 'step', data: { title: '想了想' } }])
  })

  it('一块里的多帧一次全交出来', () => {
    const reader = createFrameReader()
    const found = reader.push(
      frame('step', { title: '一' }) + frame('step', { title: '二' }),
    )
    expect(found.map((one) => one.data.title)).toEqual(['一', '二'])
  })

  it('被切成两块的一帧要拼回来', () => {
    const reader = createFrameReader()
    const whole = frame('turn.done', { reply: '好了' })
    const cut = Math.floor(whole.length / 2)
    expect(reader.push(whole.slice(0, cut))).toEqual([])
    expect(reader.push(whole.slice(cut))).toEqual([
      { name: 'turn.done', data: { reply: '好了' } },
    ])
  })

  it('逐字符喂进去也要一帧不少', () => {
    const reader = createFrameReader()
    const whole =
      frame('step', { title: '一' }) + frame('step', { title: '二' })
    const found = [...whole].flatMap((one) => reader.push(one))
    expect(found).toHaveLength(2)
  })

  it('结尾少了空行的最后一帧靠 flush 收回来', () => {
    const reader = createFrameReader()
    reader.push('event: turn.done\ndata: {"reply":"好了"}')
    expect(reader.flush()).toEqual([
      { name: 'turn.done', data: { reply: '好了' } },
    ])
  })

  it('flush 之后缓冲清空，不会再交出同一帧', () => {
    const reader = createFrameReader()
    reader.push('event: turn.done\ndata: {"reply":"好了"}')
    reader.flush()
    expect(reader.flush()).toEqual([])
  })

  it('载荷不是 JSON 的帧跳过并计数', () => {
    const reader = createFrameReader()
    // 反代挂了会塞进来一段 HTML，断言会让它一路流进渲染层
    expect(reader.push('event: step\ndata: <html>\n\n')).toEqual([])
    expect(reader.skipped()).toBe(1)
  })

  it('载荷是数组的帧也跳过', () => {
    const reader = createFrameReader()
    expect(reader.push('event: step\ndata: [1,2]\n\n')).toEqual([])
    expect(reader.skipped()).toBe(1)
  })

  it('缺事件名或缺载荷的帧不当成事件', () => {
    const reader = createFrameReader()
    expect(reader.push('data: {"a":1}\n\n')).toEqual([])
    expect(reader.push('event: step\n\n')).toEqual([])
  })

  it('一条流一个解帧器：计数不跨流累加', () => {
    const first = createFrameReader()
    first.push('event: step\ndata: 坏的\n\n')
    expect(createFrameReader().skipped()).toBe(0)
  })
})
