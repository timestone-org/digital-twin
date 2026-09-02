/**
 * @fileoverview 语音输入服务端帧的解析契约：四种帧各解成自己的样子，坏帧一律给
 * null 而不是抛——抛出去会把整条连接连同正在听的这一句一起掐断。
 */
import { describe, expect, it } from 'vitest'

import {
  EVENT_DONE,
  EVENT_READY,
  parseServerFrame,
  SPEECH_WS_PATH,
  STAGE_FINAL,
  STAGE_PARTIAL,
} from '@/features/speech/protocol'

function frame(body: unknown): string {
  return JSON.stringify(body)
}

describe('parseServerFrame', () => {
  it('system 帧按 event 判别：ready 与 done', () => {
    expect(
      parseServerFrame(frame({ type: 'system', event: EVENT_READY })),
    ).toEqual({ kind: 'ready' })
    expect(
      parseServerFrame(frame({ type: 'system', event: EVENT_DONE })),
    ).toEqual({ kind: 'done' })
  })

  it('data 帧解成整段转写，partial 与 final 都认', () => {
    const partial = frame({
      type: 'data',
      payload: { stage: STAGE_PARTIAL, text: '冷却水' },
    })
    const final = frame({
      type: 'data',
      payload: { stage: STAGE_FINAL, text: '冷却水出口温度的上限是多少？' },
    })

    expect(parseServerFrame(partial)).toEqual({
      kind: 'transcript',
      stage: 'partial',
      text: '冷却水',
    })
    expect(parseServerFrame(final)).toEqual({
      kind: 'transcript',
      stage: 'final',
      text: '冷却水出口温度的上限是多少？',
    })
  })

  it('error 帧带五位码与一句人话', () => {
    const raw = frame({ type: 'error', code: 42330, message: '识别服务没接上' })

    expect(parseServerFrame(raw)).toEqual({
      kind: 'error',
      code: 42330,
      message: '识别服务没接上',
    })
  })

  it.each([
    ['不是 JSON', '{nope'],
    ['不是对象', '[1,2]'],
    ['不认识的 type', frame({ type: 'ack' })],
    ['不认识的 system event', frame({ type: 'system', event: 'connected' })],
    ['data 缺 payload', frame({ type: 'data' })],
    [
      'data 的阶段不认识',
      frame({ type: 'data', payload: { stage: 'draft', text: 'x' } }),
    ],
    [
      'data 缺 text',
      frame({ type: 'data', payload: { stage: STAGE_PARTIAL } }),
    ],
    ['error 缺码', frame({ type: 'error', message: 'x' })],
    ['error 缺话', frame({ type: 'error', code: 1 })],
  ])('坏帧给 null：%s', (_label, raw) => {
    expect(parseServerFrame(raw)).toBeNull()
  })
})

describe('路径', () => {
  it('挂在知识库前缀下，边缘按精确匹配代给 knowledge-server', () => {
    expect(SPEECH_WS_PATH).toBe('/api/v1/knowledge/speech/ws')
  })
})
