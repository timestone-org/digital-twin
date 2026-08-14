/**
 * @fileoverview 项目自定义主题出参的线形与它到载荷的映射。
 */
import type { ProjectThemeMode, ProjectThemePayload } from '@dt/contracts'
import { PROJECT_THEME_MODES } from '@dt/contracts'

import { TransportError } from './client'
import { isRecord } from './dashboardWire'

export interface ProjectThemeWire {
  id: string
  name: string
  mode: string
  tokens: unknown
}

/**
 * 窄化明暗档。
 * ⚠ 认不出就抛：`mode` 决定这套配色按深色还是浅色的对比度口径校验，
 * 静默按某一档处理会让整套主题看上去正常而实际全不达标。
 * @param raw 线上的明暗档
 */
function toThemeMode(raw: unknown): ProjectThemeMode {
  const found = PROJECT_THEME_MODES.find((mode) => mode === raw)
  if (found === undefined) {
    throw new TransportError(0, `未知的主题明暗档：${String(raw)}`)
  }
  return found
}

/**
 * 一套主题的载荷。
 * @param wire 线上的主题
 */
export function toProjectTheme(wire: ProjectThemeWire): ProjectThemePayload {
  return {
    id: wire.id,
    name: wire.name,
    mode: toThemeMode(wire.mode),
    tokens: isRecord(wire.tokens) ? wire.tokens : {},
  }
}
