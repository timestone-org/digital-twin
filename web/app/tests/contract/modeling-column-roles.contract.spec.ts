/**
 * @fileoverview 契约：列角色的中文名表与后端的 `COLUMN_ROLES` 取值集合逐个对齐。
 *
 * 两个方向都会静默出错：表里多一个后端从不产出的键，那条译名是**永远不会亮的死
 * 代码**；少一个后端真会产出的键，那一列就一声不吭地不摆徽标，看着像后端没给
 * 角色（设计规格 D-6 同批）。typecheck 与 lint 一个都不管——两侧都只是字符串。
 * ⚠ 对着 Python 源码比而不是 openapi：角色是帧内部的字段，不出 HTTP 面。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const WEB_ROOT = process.cwd()

const FRAME_PY = join(
  WEB_ROOT,
  '..',
  'server',
  'services',
  'platform-server',
  'src',
  'platform_server',
  'apps',
  'modeling',
  'operators',
  'frame.py',
)

const FRAME_VUE = join(
  WEB_ROOT,
  'app',
  'src',
  'pages',
  'Modeling',
  'Canvas',
  'components',
  'FrameView.vue',
)

/** `ROLE_FEATURE = "feature"` 这一族常量。 */
const PY_CONST = /^(ROLE_[A-Z_]+)\s*=\s*"([a-z_]+)"$/gm
/** `COLUMN_ROLES: tuple[str, ...] = (ROLE_FEATURE, …)` 里列的那几个名字。 */
const PY_TUPLE = /^COLUMN_ROLES[^=]*=\s*\(([^)]*)\)/m
/** 前端那张译名表的整块。 */
const TS_TABLE = /const ROLE_LABELS: Record<string, string> = \{([^}]*)\}/
/** 表里的键。 */
const TS_KEY = /^\s*([a-z_]+):/gm

function backendRoles(): string[] {
  const source = readFileSync(FRAME_PY, 'utf8')
  const values = new Map(
    [...source.matchAll(PY_CONST)].map(([, name, value]) => [
      name,
      value ?? '',
    ]),
  )
  const listed = PY_TUPLE.exec(source)?.[1] ?? ''
  return listed
    .split(',')
    .map((name) => values.get(name.trim()) ?? '')
    .filter((role) => role !== '')
    .sort()
}

function frontendRoles(): string[] {
  const block = TS_TABLE.exec(readFileSync(FRAME_VUE, 'utf8'))?.[1] ?? ''
  return [...block.matchAll(TS_KEY)].map(([, key]) => key ?? '').sort()
}

describe('列角色两侧对齐', () => {
  it('两侧都扫得出东西来，别让下面那条对着空表报绿', () => {
    expect(backendRoles().length).toBeGreaterThanOrEqual(3)
    expect(frontendRoles().length).toBeGreaterThanOrEqual(3)
  })

  // ⚠ 多的是死代码、少的是不摆徽标，两种都不报错
  it('译名表的键集与后端的取值集合一个不多一个不少', () => {
    expect(frontendRoles()).toEqual(backendRoles())
  })
})
