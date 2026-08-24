/**
 * @fileoverview 把 `@dt/contracts` 的助手类型钉在 ai-assistant 的
 * openapi.json 上。
 *
 * 做法与 `collect-shapes.contract.spec.ts` 同源，理由也同源：手写的类型比真接口
 * 宽松时，页面对着不存在的字段取值会拿到 undefined 并崩在渲染里，而 typecheck、
 * lint、单测全绿——编译器无从知道后端把字段叫什么。
 *
 * ⚠ 还钉一件事：工作面这个闭合集合两侧必须逐字一致。漂开的表现是「助手在某一页
 * 上一个技能都没有」，而两边代码单看都对。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  AssistantCapability,
  AssistantMessage,
  AssistantSession,
  AssistantSessionDetail,
  AssistantSkill,
  AssistantStep,
} from '@dt/contracts'
import {
  ASSISTANT_MESSAGE_ROLES,
  ASSISTANT_STEP_KINDS,
  ASSISTANT_STEP_STATES,
  ASSISTANT_SURFACE_KINDS,
} from '@dt/contracts'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'ai-assistant',
  'openapi.json',
)

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  components: { schemas: Record<string, OpenApiSchema> }
}
const schemas = spec.components.schemas

const ENUMS_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'ai-assistant',
  'src',
  'ai_assistant',
  'apps',
  'chat',
  'enums.py',
)

type Keys<T> = Record<keyof T, true>

const SHAPES: Record<string, Record<string, true>> = {
  CapabilityOut: {
    is_model_enabled: true,
    is_vision_enabled: true,
    skills: true,
  } satisfies Keys<AssistantCapability>,
  SkillOut: {
    name: true,
    title: true,
    summary: true,
    surface_kinds: true,
    required_codes: true,
  } satisfies Keys<AssistantSkill>,
  SessionOut: {
    id: true,
    user_id: true,
    title: true,
    surface_kind: true,
    surface_ref: true,
    is_archived: true,
    row_version: true,
    last_error: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<AssistantSession>,
  SessionDetailOut: {
    id: true,
    user_id: true,
    title: true,
    surface_kind: true,
    surface_ref: true,
    is_archived: true,
    row_version: true,
    last_error: true,
    created_at: true,
    updated_at: true,
    messages: true,
  } satisfies Keys<AssistantSessionDetail>,
  MessageOut: {
    id: true,
    session_id: true,
    seq: true,
    role: true,
    content_json: true,
    usage_json: true,
    steps: true,
    created_at: true,
  } satisfies Keys<AssistantMessage>,
  StepOut: {
    id: true,
    message_id: true,
    seq: true,
    kind: true,
    name: true,
    state: true,
    input_json: true,
    output_json: true,
    error: true,
    started_at: true,
    ended_at: true,
    created_at: true,
  } satisfies Keys<AssistantStep>,
}

describe('@dt/contracts 的助手类型与 openapi.json 的字段一致', () => {
  it.each(Object.keys(SHAPES))('%s', (schemaName) => {
    const schema = schemas[schemaName]
    expect(schema, `openapi.json 里没有 ${schemaName}`).toBeDefined()
    const actual = Object.keys(schema?.properties ?? {}).sort()
    const declared = Object.keys(SHAPES[schemaName] ?? {}).sort()
    expect(actual).toEqual(declared)
  })
})

describe('工作面的闭合集合两侧一致', () => {
  // 后端的真源在 enums.py 的 SURFACE_KINDS（迁移的 CHECK 约束抄的也是它）。
  // openapi 里眼下还没有哪个端点收这个枚举，所以直接对着那份源码比——
  // 漂开的表现是「助手在某一页上一个技能都没有」，而两边代码单看都对。

  function backendSurfaceKinds(): string[] {
    const source = readFileSync(ENUMS_PATH, 'utf8')
    const block = /SURFACE_KINDS = \(([\s\S]*?)\)/.exec(source)?.[1] ?? ''
    return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? '')
  }

  it('确实读到了后端那份清单（读不到就等于这条闸没跑）', () => {
    expect(backendSurfaceKinds().length).toBeGreaterThan(0)
  })

  it('两侧逐字相同', () => {
    expect([...ASSISTANT_SURFACE_KINDS].sort()).toEqual(
      backendSurfaceKinds().sort(),
    )
  })
})

describe('三个闭合集合与后端 enums.py 里的那一份逐字相同', () => {
  // 与工作面同源：漂开时前端会把一个合法状态渲染成「未知」，而两边代码单看都对
  function backendTuple(name: string): string[] {
    const source = readFileSync(ENUMS_PATH, 'utf8')
    const block = new RegExp(`${name} = \\(([\\s\\S]*?)\\)`).exec(
      source,
    )?.[1]
    return [...(block ?? '').matchAll(/"([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    )
  }

  it('消息角色', () => {
    expect([...ASSISTANT_MESSAGE_ROLES].sort()).toEqual(
      backendTuple('MESSAGE_ROLES').sort(),
    )
  })

  it('步骤种类', () => {
    expect([...ASSISTANT_STEP_KINDS].sort()).toEqual(
      backendTuple('STEP_KINDS').sort(),
    )
  })

  it('步骤状态', () => {
    expect([...ASSISTANT_STEP_STATES].sort()).toEqual(
      backendTuple('STEP_STATES').sort(),
    )
  })
})
