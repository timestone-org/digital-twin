/**
 * @fileoverview 语音输入两侧要逐字对上的常量：动作名、阶段名、事件名、WS 路径。
 * 唯一真源是 knowledge-server 的 `apps/speech/services/protocol.py`，前端那份是复述。
 *
 * ⚠ 对不上的表现不是报错：stop 拼错了，服务端只会把它当一帧不认识的文本忽略，
 * 界面上是「整理中…」一直转到兜底超时；stage 拼错了转写永远不上屏。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REALTIME_AUTH_SUBPROTOCOL,
  REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE,
} from '@dt/contracts'

import * as protocol from '@/features/speech/protocol'

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SERVICE_SRC = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'knowledge-server',
  'src',
  'knowledge_server',
)
const PROTOCOL_PY = join(
  SERVICE_SRC,
  'apps',
  'speech',
  'services',
  'protocol.py',
)
const SETTINGS_PY = join(SERVICE_SRC, 'settings.py')

/** 两侧同名的常量；前端模块里必须一个不少。 */
const SHARED = [
  'ACTION_STOP',
  'ACTION_CANCEL',
  'STAGE_PARTIAL',
  'STAGE_FINAL',
  'EVENT_READY',
  'EVENT_DONE',
  'SPEECH_WS_PATH',
] as const

/** 名字不同、值必须相同的几个：子协议标记与关闭码前端复用 `@dt/contracts` 的。 */
const ALIASED: readonly (readonly [string, string | number])[] = [
  ['AUTH_SUBPROTOCOL', REALTIME_AUTH_SUBPROTOCOL],
  ['CLOSE_UNAUTHENTICATED', REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE],
  ['CLOSE_ASR_UNAVAILABLE', protocol.SPEECH_UNAVAILABLE_CLOSE_CODE],
]

const PREFIX_PLACEHOLDER = '{API_PREFIX}'

/** 后端顶层 `NAME = ...` 那一行的右侧原文。 */
function rightHandSide(source: string, name: string): string {
  const head = `${name} = `
  const line = source.split('\n').find((one) => one.startsWith(head))
  if (line === undefined) throw new Error(`后端 protocol.py 里没有 ${name}`)
  return line.slice(head.length).trim()
}

/** 字符串去掉引号（f-string 里的 `{API_PREFIX}` 用 settings.py 的值代进去）；数字原样。 */
function literalOf(raw: string, apiPrefix: string): string {
  const isFormatted = raw.startsWith('f"') || raw.startsWith("f'")
  const isQuoted = raw.startsWith('"') || raw.startsWith("'")
  if (!isFormatted && !isQuoted) return raw
  const body = raw.slice(isFormatted ? 2 : 1, -1)
  return isFormatted ? body.replace(PREFIX_PLACEHOLDER, apiPrefix) : body
}

describe('语音输入协议常量', () => {
  const py = readFileSync(PROTOCOL_PY, 'utf8')
  const apiPrefix = literalOf(
    rightHandSide(readFileSync(SETTINGS_PY, 'utf8'), 'API_PREFIX'),
    '',
  )

  it.each(SHARED)('%s 两侧逐字相同', (name) => {
    expect(literalOf(rightHandSide(py, name), apiPrefix)).toBe(protocol[name])
  })

  it.each(ALIASED)('%s 与前端的同值常量逐字相同', (name, value) => {
    expect(literalOf(rightHandSide(py, name), apiPrefix)).toBe(String(value))
  })

  it('WS 路径落在知识库前缀下，边缘那条精确匹配的 location 才接得住', () => {
    expect(protocol.SPEECH_WS_PATH.startsWith(apiPrefix)).toBe(true)
    expect(protocol.SPEECH_WS_PATH.endsWith('/speech/ws')).toBe(true)
  })
})
