/** @fileoverview 周期训练与自动发布字段与 platform OpenAPI 保持一致。 */
import type { ModelingSchedule, ModelingScheduleInput } from '@dt/contracts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
const spec: {
  components: {
    schemas: Record<string, { properties?: Record<string, unknown> }>
  }
  paths: Record<string, unknown>
} = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      '..',
      'server',
      'services',
      'platform-server',
      'openapi.json',
    ),
    'utf8',
  ),
)
it('定时规则读写字段逐一匹配后端Schema', () => {
  const output = {
    pipeline_id: true,
    is_enabled: true,
    interval_minutes: true,
    auto_publish: true,
    next_run_at: true,
    last_run_at: true,
    last_run_id: true,
    last_error: true,
    revision: true,
    updated_at: true,
  } satisfies Record<keyof ModelingSchedule, true>
  const input = {
    is_enabled: true,
    interval_minutes: true,
    auto_publish: true,
    first_run_at: true,
    expected_revision: true,
  } satisfies Record<keyof ModelingScheduleInput, true>
  expect(Object.keys(output).sort()).toEqual(
    Object.keys(
      spec.components.schemas['ModelingScheduleOut']?.properties ?? {},
    ).sort(),
  )
  expect(Object.keys(input).sort()).toEqual(
    Object.keys(
      spec.components.schemas['ModelingScheduleIn']?.properties ?? {},
    ).sort(),
  )
})
it('工作流模板创建、定时、训练删除与直接发布都有独立端点', () => {
  expect(Object.keys(spec.paths)).toEqual(
    expect.arrayContaining([
      '/api/v1/platform/modeling-pipelines/{pipeline_id}/schedule',
      '/api/v1/platform/modeling-templates/{template_id}:create-workflow',
      '/api/v1/platform/modeling-runs/{run_id}:deploy',
      '/api/v1/platform/modeling-runs/{run_id}',
    ]),
  )
})
