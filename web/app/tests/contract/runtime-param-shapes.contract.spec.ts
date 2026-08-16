/**
 * @fileoverview 把运行参数的线形钉在 platform-server 的 openapi.json 上。
 *
 * 这道闸此前不存在，代价是真实事故：线形写的 `default` / `overridden` 与后端
 * 的 `default_value` / `is_overridden` 从未一致，弹窗里默认值恒空、「已覆盖」
 * 徽标永远不亮，而 typecheck、lint、单测全绿。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { RuntimeParamItemWire } from '@/api/runtimeParamsWire'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'openapi.json',
)

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  components: { schemas: Record<string, OpenApiSchema> }
}

type Keys<T> = Record<keyof T, true>

const WIRE_KEYS = {
  section: true,
  key: true,
  env_name: true,
  write_code: true,
  label: true,
  hint: true,
  kind: true,
  unit: true,
  step: true,
  minimum: true,
  maximum: true,
  tier: true,
  danger: true,
  value: true,
  default_value: true,
  previous_value: true,
  is_overridden: true,
  updated_by: true,
  updated_at: true,
} satisfies Keys<RuntimeParamItemWire>

describe('运行参数线形与 openapi 一致', () => {
  it('RuntimeParamItemWire 的键与 RuntimeParamOut 逐字相等', () => {
    const schema = spec.components.schemas['RuntimeParamOut']
    expect(schema).toBeDefined()
    const declared = Object.keys(schema?.properties ?? {}).sort()
    expect(Object.keys(WIRE_KEYS).sort()).toEqual(declared)
  })
})
