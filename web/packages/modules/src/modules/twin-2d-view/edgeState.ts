/**
 * @fileoverview 连线运行态的取值归一：把「有流 / 通电」与「流向」两个子槽的原始点位值
 * 收敛成两个布尔。两张词表逐字取自参考项目（docs/MODULE_TWIN_2D_DESIGN.md §7.12 #97）。
 *
 * ⚠ 放在模块目录而不是 `@dt/twin2d`：包里只收**已经归一**的 `Twin2dEdgeState`，
 * 它的类型面上根本没有「原始点位值」这个概念；而本仓「共享包的入场券是已有 ≥2 个
 * 真实消费方」，眼下只有 2D 孪生有连线。
 */

/**
 * 判成「有流 / 通电」的词。
 * ⚠ 词表只对**字符串**生效，且查表前一律 `trim().toLowerCase()`：现场点位吐回来的
 * 是 `"ON"` / `" running "` 这类没规矩的串，不归一就整批落进「认不出」那一档。
 */
const TRUTHY = new Set([
  '1',
  'true',
  'on',
  'open',
  'run',
  'running',
  'active',
  'enable',
  'enabled',
  'yes',
  'y',
])

/** 判成「无流 / 断电」的词。 */
const FALSY = new Set([
  '0',
  'false',
  'off',
  'close',
  'closed',
  'stop',
  'stopped',
  'inactive',
  'disable',
  'disabled',
  'no',
  'n',
])

/** 明确表达「倒着流」的词。 */
const REVERSE_WORDS = new Set([
  'reverse',
  'reversed',
  'backward',
  'back',
  'rev',
  'ccw',
  'left',
  '反向',
  '逆向',
])

/** 明确表达「照常流」的词。 */
const FORWARD_WORDS = new Set([
  'forward',
  'forwards',
  'normal',
  'front',
  'fwd',
  'cw',
  'right',
  '正向',
  '顺向',
])

/**
 * 任意原值归一成布尔：真假词表 + 数字 0/非 0 + 原生 boolean。
 * ⚠ 认不出的**非空**值回落 `fallback` 而不是 false：读不懂的一个值不该把一条本来
 * 活跃的连线画成灰的——「看不懂」与「确实没流」是两件事。
 * @param raw 子槽读回来的原值
 * @param fallback 空值或认不出时的回退
 */
export function boolFromValue(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  if (typeof raw !== 'string') return fallback
  const word = raw.trim().toLowerCase()
  if (word === '') return fallback
  if (TRUTHY.has(word)) return true
  if (FALSY.has(word)) return false
  return fallback
}

/**
 * 任意原值判成「反向」：只有负数与明确的反向词才算。
 * ⚠ **原生 boolean 一律 false**，这条反直觉：设备的 on/off 表达的是「这条管路通不通」
 * 而不是「往哪边流」，把 `false` 读成反向会让每一条停掉的连线上箭头集体掉头。
 * ⚠ 字符串先过 `Number()` 再查词表：现场把 `-1` 当字符串发回来是常态。
 * @param raw 流向子槽读回来的原值
 */
export function reverseFromValue(raw: unknown): boolean {
  if (typeof raw === 'boolean') return false
  if (typeof raw === 'number') return raw < 0
  if (typeof raw !== 'string') return false
  const word = raw.trim().toLowerCase()
  if (word === '') return false
  const parsed = Number(word)
  if (!Number.isNaN(parsed)) return parsed < 0
  if (REVERSE_WORDS.has(word)) return true
  if (FORWARD_WORDS.has(word)) return false
  return false
}
