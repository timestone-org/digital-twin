/**
 * @fileoverview 一步的入参与产出摊成能直接画出来的样子。
 *
 * ⚠ 服务端已经有一份同口径的实现（`step_preview.py`），这里仍要再写一份：
 * **客户端工具压根不经过服务端**——它们的入参与产出只存在于浏览器里，
 * 服务端那份钳制够不着。两份的上限要一致，否则同一屏上两类步骤的截断位置不同，
 * 看起来像是「有的步骤被吞了内容」。
 *
 * ⚠ 值一律摊成字符串。留着嵌套结构的话，渲染要为「任意 JSON」写一套分支，
 * 而每个分支都得有人测；摊平之后它只有一种形状：一张键值表。
 */

/** 一个入参值最多留多少字。 */
export const MAX_VALUE_CHARS = 200
/** 一步最多摊几个入参。 */
export const MAX_KEYS = 20
/** 产出预览的上限。 */
export const MAX_OUTPUT_CHARS = 1_500

const ELLIPSIS = '…'
/** 内嵌图片的 data URI 前缀。⚠ 与服务端 `vision.is_image` 同一条判定。 */
const IMAGE_PREFIX = 'data:image/'

/**
 * 这个产出是不是一张内嵌的图。
 * ⚠ 图要单拎出来：混在文本产出里的话，界面上会出现几十万字符的一坨 base64。
 * @param given 工具产出
 */
export function isImageOutput(given: unknown): given is string {
  return typeof given === 'string' && given.startsWith(IMAGE_PREFIX)
}

/**
 * 入参摊成一张键值表；没有入参给 `null`。
 * @param given 原始入参（对象），或服务端已经摊平的那一份
 */
export function inputPreview(given: unknown): Record<string, string> | null {
  const body = asObject(given)
  if (body === null) return null
  const keys = Object.keys(body)
  if (keys.length === 0) return null
  const flat: Record<string, string> = {}
  for (const key of keys.slice(0, MAX_KEYS)) {
    flat[key] = clamped(asText(body[key]), MAX_VALUE_CHARS)
  }
  if (keys.length > MAX_KEYS) {
    flat[ELLIPSIS] = `另有 ${keys.length - MAX_KEYS} 项未摊开`
  }
  return flat
}

/**
 * 产出摊成一段文字；没有产出、或产出是一张图，都给 `null`。
 *
 * ⚠ 认得出 `{ body: … }` 就只取那一格：服务端落库时把结果包了一层，
 * 连壳一起显示的话，回放出来的每一步产出前面都顶着一个 `{"body":"`。
 *
 * @param given 工具产出，或库里存的那一份
 */
export function outputPreview(given: unknown): string | null {
  if (given === undefined || given === null || isImageOutput(given)) return null
  const body = asObject(given)?.body
  const text = clamped(
    asText(typeof body === 'string' ? body : given),
    MAX_OUTPUT_CHARS,
  )
  return text === '' ? null : text
}

function asObject(given: unknown): Record<string, unknown> | null {
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    return null
  }
  return { ...given }
}

/**
 * 一个值摊成文字。裸串原样，其余走 JSON。
 * ⚠ 裸串不走 JSON：走了的话每个字符串值都被套上一对引号，而那是给机器看的。
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // 循环引用一类：说清楚它画不出来，而不是让整张卡片空着
    return '（这个值展不开）'
  }
}

/** 钳到上限内，截断要说出来——静默截断会让人把半份产出当成全部。 */
function clamped(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}${ELLIPSIS}（共 ${text.length} 字，已截断）`
}
