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
  AssistantAskAnswer,
  AssistantAskOption,
  AssistantAskRequest,
  AssistantCapability,
  AssistantCredentialStatus,
  AssistantDeviceLoginPoll,
  AssistantDeviceLoginStart,
  AssistantModelProfile,
  AssistantMessage,
  AssistantParsedTable,
  AssistantSession,
  AssistantSessionDetail,
  AssistantSkill,
  AssistantStep,
} from '@dt/contracts'
import {
  ASSISTANT_ASK_TOOL,
  ASSISTANT_DELTA_CHANNELS,
  ASSISTANT_EVENT_NAMES,
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

// 事件集合的真源。⚠ openapi 描述不了 SSE 的载荷，所以只能对着这份源码比
const EVENTS_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'ai-assistant',
  'src',
  'ai_assistant',
  'apps',
  'chat',
  'services',
  'output',
  'events.py',
)

// 客户端工具规格的真源。⚠ 客户端工具的入参 openapi 里没有（它们在浏览器里
// 执行，服务端只下发形状），所以只能对着那份源码比——漂开的表现是「模型看得见
// 这个工具、调用却每次都失败」，而失败的样子与「这一页没实现它」一模一样
const CLIENT_SPECS_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'ai-assistant',
  'src',
  'ai_assistant',
  'apps',
  'chat',
  'services',
  'tools',
  'providers',
  'client_specs',
  'core.py',
)

type Keys<T> = Record<keyof T, true>

const SHAPES: Record<string, Record<string, true>> = {
  CapabilityOut: {
    is_model_enabled: true,
    skills: true,
    models: true,
    default_model_id: true,
    default_effort: true,
  } satisfies Keys<AssistantCapability>,
  ModelProfileOut: {
    id: true,
    label: true,
    is_ready: true,
    has_vision: true,
    models: true,
    efforts: true,
  } satisfies Keys<AssistantModelProfile>,
  CredentialStatusOut: {
    provider: true,
    is_connected: true,
    account_label: true,
    plan_label: true,
    expires_at: true,
    last_refresh_at: true,
    last_error: true,
  } satisfies Keys<AssistantCredentialStatus>,
  DeviceLoginStartOut: {
    ref: true,
    user_code: true,
    verification_uri: true,
    interval_s: true,
    expires_in_s: true,
  } satisfies Keys<AssistantDeviceLoginStart>,
  DeviceLoginPollOut: {
    is_done: true,
    interval_s: true,
    status: true,
  } satisfies Keys<AssistantDeviceLoginPoll>,
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
    model_profile: true,
    reasoning_effort: true,
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
    model_profile: true,
    reasoning_effort: true,
    created_at: true,
    updated_at: true,
    messages: true,
    plan_json: true,
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
  AttachmentParseOut: {
    columns: true,
    rows: true,
    is_truncated: true,
    total_rows: true,
    text: true,
  } satisfies Keys<AssistantParsedTable>,
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
    const block = new RegExp(`${name} = \\(([\\s\\S]*?)\\)`).exec(source)?.[1]
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

describe('事件流的事件名两侧逐字相同', () => {
  // ⚠ SSE 的载荷 openapi 描述不了，所以这是一份「没有生成物兜底」的契约。
  // 漂开的表现是「助手做了一步但界面上没有」——前端遇到没见过的事件名只能
  // 静默丢弃，而两边代码单看都对。
  function backendEventNames(): string[] {
    const source = readFileSync(EVENTS_PATH, 'utf8')
    const block = /EVENT_NAMES = \(([\s\S]*?)\)/.exec(source)?.[1] ?? ''
    const constants = [...block.matchAll(/EVENT_[A-Z_]+/g)].map(
      (match) => match[0],
    )
    return constants.map((name) => {
      const assigned = new RegExp(`^${name} = "([^"]+)"`, 'm').exec(source)
      return assigned?.[1] ?? name
    })
  }

  it('确实读到了后端那份清单（读不到就等于这条闸没跑）', () => {
    expect(backendEventNames().length).toBeGreaterThan(0)
  })

  it('两侧逐字相同', () => {
    expect([...ASSISTANT_EVENT_NAMES].sort()).toEqual(
      backendEventNames().sort(),
    )
  })

  it('增量的两路与后端的字面量一致', () => {
    // 混成一路或多出一路，界面会把模型的自言自语当成结论铺出来
    const source = readFileSync(
      join(
        process.cwd(),
        '..',
        'server',
        'services',
        'ai-assistant',
        'src',
        'ai_assistant',
        'llm',
        'deltas.py',
      ),
      'utf8',
    )
    const block = /DeltaChannel = Literal\[([^\]]*)\]/.exec(source)?.[1] ?? ''
    const channels = [...block.matchAll(/"([^"]+)"/g)].map(
      (match) => match[1] ?? '',
    )
    expect([...ASSISTANT_DELTA_CHANNELS].sort()).toEqual(channels.sort())
  })
})

describe('user.ask 的入参两侧逐字一致', () => {
  // JSON Schema 自己的词，不是这个工具的参数名
  const VOCABULARY = new Set([
    'type',
    'description',
    'properties',
    'required',
    'items',
    'additionalProperties',
  ])

  /** 后端那份规格里 `user.ask` 那一段。 */
  function askBlock(): string {
    const source = readFileSync(CLIENT_SPECS_PATH, 'utf8')
    const from = source.indexOf(`name="${ASSISTANT_ASK_TOOL}"`)
    const to = source.indexOf('runs_on="client"', from)
    return from < 0 || to < 0 ? '' : source.slice(from, to)
  }

  /** 那一段里出现的参数名（连选项自己的那三格）。 */
  function backendKeys(): string[] {
    return [...askBlock().matchAll(/"(\w+)":/g)]
      .map((match) => match[1] ?? '')
      .filter((name) => !VOCABULARY.has(name))
      .sort()
  }

  it('确实读到了后端那一段（读不到就等于这条闸没跑）', () => {
    expect(askBlock().length).toBeGreaterThan(0)
    expect(backendKeys().length).toBeGreaterThan(0)
  })

  it('参数名一个不多一个不少', () => {
    const declared: Record<string, true> = {
      question: true,
      options: true,
      allow_multiple: true,
      allow_free_text: true,
      free_text_label: true,
    } satisfies Keys<AssistantAskRequest>
    const perOption: Record<string, true> = {
      value: true,
      label: true,
      hint: true,
    } satisfies Keys<Required<AssistantAskOption>>
    expect(backendKeys()).toEqual(
      [...Object.keys(declared), ...Object.keys(perOption)].sort(),
    )
  })

  it('问题与选项两格是必给的', () => {
    // ⚠ options 做成可选的话，模型会一路退回「不给选项的自由提问」
    const required = /\[\s*"question",\s*"options",?\s*\]/
    expect(required.test(askBlock())).toBe(true)
  })

  it('回执那三格在规格里说清了', () => {
    const answer: Record<string, true> = {
      picked: true,
      free_text: true,
      is_cancelled: true,
    } satisfies Keys<AssistantAskAnswer>
    const block = askBlock()
    for (const key of Object.keys(answer)) expect(block).toContain(key)
  })
})
