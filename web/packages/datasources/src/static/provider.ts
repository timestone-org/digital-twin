/**
 * @fileoverview 常量（`static`）来源的 provider：值就写在绑定里，
 * 没有连接也没有历史。
 */
import type { DataSourceProvider } from '@dt/contracts'

import { refuseHistory, refuseSubscribe } from '../capability'
import { DataSourceError } from '../errors'
import type { DataSlot } from '../slot'
import { errorSlot, okSlot } from '../slot'

const KIND = 'static'

/**
 * 取常量绑定的值。
 * ⚠ `0` / `false` / `''` 都是合法常量，只有没配过（`undefined` / `null`）
 * 才算取不到——把 falsy 当成「还没有值」会让一整屏的零值消失。
 * @param configured 绑定的 `staticValueJson`
 */
export function resolveStaticValue(configured: unknown): DataSlot<unknown> {
  if (configured === undefined || configured === null) {
    return errorSlot(
      new DataSourceError('missing-static-value', 'static 绑定没有配置常量值'),
    )
  }
  return okSlot(configured)
}

/** 造一个常量 provider。 */
export function createStaticProvider(): DataSourceProvider {
  return {
    kind: KIND,
    subscribe: (nodeKeys) => refuseSubscribe(KIND, nodeKeys),
    readHistory: () => refuseHistory(KIND),
  }
}
