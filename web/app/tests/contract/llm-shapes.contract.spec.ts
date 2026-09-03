/**
 * @fileoverview 把 `@dt/contracts` 的模型供应商类型钉在 platform-server 的
 * openapi.json 上，并把用途码与模型种类对着三个服务的源码逐字比（ADR-0039）。
 *
 * 做法与 `assistant-shapes.contract.spec.ts` 同源：手写的类型比真接口宽松时，
 * 页面对着不存在的字段取值会拿到 undefined 并崩在渲染里，而 typecheck、
 * lint、单测全绿。
 *
 * ⚠ 用途码是**三方契约**：平台登记它、助手与知识库各自复述自己那几条去目录里
 * 查，三处漂开的表现是「界面上分配了、那一侧却还在用环境变量那一档」，
 * 而三边代码单看都对。服务之间不许互相 import，只有这里能把三份放在一起比。
 *
 * ⚠ 接入形态同理（ADR-0040）：平台登记它、助手按它挑适配器、前端按它渲染表单。
 * 漂开的表现是「界面上配好了一路 Codex、助手却当它不存在」。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  LlmCredential,
  LlmDeviceLoginPoll,
  LlmDeviceLoginStart,
  LlmModel,
  LlmProbeResult,
  LlmProvider,
  LlmProviderKind,
  LlmProviderPreset,
  LlmPurpose,
} from '@dt/contracts'
import {
  LLM_MODEL_KINDS,
  LLM_PROVIDER_KINDS,
  LLM_PURPOSES,
} from '@dt/contracts'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SERVER = join(process.cwd(), '..', 'server')
const SPEC_PATH = join(SERVER, 'services', 'platform-server', 'openapi.json')
const PLATFORM_ENUMS = join(
  SERVER,
  'services',
  'platform-server',
  'src',
  'platform_server',
  'apps',
  'llm_providers',
  'enums.py',
)
const ASSISTANT_PORTS = join(
  SERVER,
  'services',
  'ai-assistant',
  'src',
  'ai_assistant',
  'llm',
  'ports.py',
)
const KNOWLEDGE_PURPOSES = join(
  SERVER,
  'services',
  'knowledge-server',
  'src',
  'knowledge_server',
  'llm_purposes.py',
)
const LLMCORE_CATALOG = join(
  SERVER,
  'domain',
  'llmcore',
  'src',
  'llmcore',
  'catalog.py',
)
const MIGRATION = join(
  SERVER,
  'services',
  'platform-server',
  'migrations',
  'versions',
  '2026_09_02_1200-c4d8e2a71f35_add_llm_providers.py',
)
const KIND_MIGRATION = join(
  SERVER,
  'services',
  'platform-server',
  'migrations',
  'versions',
  '2026_09_03_1000-a7e1c93b6d40_add_llm_provider_kind.py',
)

const schemas = (
  JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
    components: { schemas: Record<string, OpenApiSchema> }
  }
).components.schemas

type Keys<T> = Record<keyof T, true>

const SHAPES: Record<string, Record<string, true>> = {
  LlmProviderOut: {
    id: true,
    name: true,
    kind: true,
    base_url: true,
    api_key_hint: true,
    is_enabled: true,
    extra_body: true,
    options: true,
    models: true,
    notes: true,
    assigned_purposes: true,
    updated_by: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<LlmProvider>,
  LlmProviderKindOut: {
    code: true,
    label: true,
    description: true,
    is_endpoint_required: true,
    is_login_required: true,
    model_kinds: true,
    consumers: true,
    efforts: true,
    presets: true,
  } satisfies Keys<LlmProviderKind>,
  LlmProviderPresetOut: {
    code: true,
    label: true,
    base_url: true,
  } satisfies Keys<LlmProviderPreset>,
  LlmModelOut: {
    name: true,
    kind: true,
    has_vision: true,
    dimensions: true,
  } satisfies Keys<LlmModel>,
  LlmProbeOut: {
    is_ok: true,
    message: true,
    model_names: true,
  } satisfies Keys<LlmProbeResult>,
  LlmPurposeOut: {
    purpose: true,
    label: true,
    description: true,
    kind: true,
    consumer: true,
    is_vision_required: true,
    provider_id: true,
    provider_name: true,
    model_name: true,
    updated_at: true,
  } satisfies Keys<LlmPurpose>,
  LlmCredentialOut: {
    provider_id: true,
    is_connected: true,
    account_label: true,
    plan_label: true,
    expires_at: true,
    last_refresh_at: true,
    last_error: true,
  } satisfies Keys<LlmCredential>,
  LlmDeviceLoginStartOut: {
    ref: true,
    user_code: true,
    verification_uri: true,
    interval_s: true,
    expires_in_s: true,
  } satisfies Keys<LlmDeviceLoginStart>,
  LlmDeviceLoginPollOut: {
    is_done: true,
    interval_s: true,
    credential: true,
  } satisfies Keys<LlmDeviceLoginPoll>,
}

describe('@dt/contracts 的模型供应商类型与 openapi.json 的字段一致', () => {
  it.each(Object.keys(SHAPES))('%s', (schemaName) => {
    const schema = schemas[schemaName]
    expect(schema, `openapi.json 里没有 ${schemaName}`).toBeDefined()
    const actual = Object.keys(schema?.properties ?? {}).sort()
    const declared = Object.keys(SHAPES[schemaName] ?? {}).sort()
    expect(actual).toEqual(declared)
  })

  it('出参里永远没有密钥明文', () => {
    const provider = schemas['LlmProviderOut']
    expect(Object.keys(provider?.properties ?? {})).not.toContain('api_key')
  })

  it('登录态那几个出参里永远没有令牌', () => {
    // ⚠ 出去过一次就永远躺在别人的 devtools 里：短时令牌只走 /internal/，
    // 而那一族刻意不进 openapi
    for (const name of ['LlmCredentialOut', 'LlmDeviceLoginPollOut']) {
      const keys = Object.keys(schemas[name]?.properties ?? {})
      expect(keys).not.toContain('access_token')
      expect(keys).not.toContain('refresh_token')
    }
  })
})

/** 一份 Python 源码里 `PurposeSpec(code="…")` 或 `"a.b"` 字面量。 */
function quotedDotted(source: string): string[] {
  return [...source.matchAll(/"([a-z]+\.[a-z]+)"/g)].map(
    (match) => match[1] ?? '',
  )
}

describe('用途码三方逐字一致', () => {
  const platform = [
    ...new Set(quotedDotted(readFileSync(PLATFORM_ENUMS, 'utf8'))),
  ].sort()

  it('确实读到了平台那份清单（读不到就等于这条闸没跑）', () => {
    expect(platform.length).toBeGreaterThan(0)
  })

  it('前端与平台一致', () => {
    expect([...LLM_PURPOSES].sort()).toEqual(platform)
  })

  it('助手复述的那几条都在平台清单里，且它自己那一族一条不少', () => {
    const assistant = [
      ...new Set(quotedDotted(readFileSync(ASSISTANT_PORTS, 'utf8'))),
    ].sort()
    expect(assistant.length).toBeGreaterThan(0)
    expect(assistant).toEqual(
      platform.filter((code) => code.startsWith('assistant.')),
    )
  })

  it('知识库复述的那几条都在平台清单里，且它自己那一族一条不少', () => {
    const knowledge = [
      ...new Set(quotedDotted(readFileSync(KNOWLEDGE_PURPOSES, 'utf8'))),
    ].sort()
    expect(knowledge.length).toBeGreaterThan(0)
    expect(knowledge).toEqual(
      platform.filter((code) => code.startsWith('knowledge.')),
    )
  })

  it('迁移里写死的 CHECK 集合与平台清单一致', () => {
    // ⚠ 迁移是冻结件、活常量是活的：加一档用途时两边都要动，这里就是那道红灯
    const source = readFileSync(MIGRATION, 'utf8')
    const block = /PURPOSES = \(([\s\S]*?)\n\)/.exec(source)?.[1] ?? ''
    const listed = [...block.matchAll(/'([a-z]+\.[a-z]+)'/g)]
      .map((match) => match[1] ?? '')
      .sort()
    expect(listed).toEqual(platform)
  })
})

describe('模型种类两侧逐字一致', () => {
  function kindsOf(path: string, name: string): string[] {
    const source = readFileSync(path, 'utf8')
    const block = new RegExp(`${name}[^=]*= \\(([^)]*)\\)`).exec(source)?.[1]
    return [...(block ?? '').matchAll(/"([a-z]+)"|MODEL_KIND_([A-Z]+)/g)]
      .map((match) => match[1] ?? (match[2] ?? '').toLowerCase())
      .filter((one) => one !== '')
      .sort()
  }

  it('平台的 MODEL_KINDS', () => {
    expect(kindsOf(PLATFORM_ENUMS, 'MODEL_KINDS')).toEqual(
      [...LLM_MODEL_KINDS].sort(),
    )
  })

  it('llmcore 的 MODEL_SPEC_KINDS', () => {
    expect(kindsOf(LLMCORE_CATALOG, 'MODEL_SPEC_KINDS')).toEqual(
      [...LLM_MODEL_KINDS].sort(),
    )
  })
})

/** 一份 Python 源码里 `PROVIDER_KIND_X = "…"` 的取值。 */
function kindLiterals(source: string): string[] {
  return [...source.matchAll(/PROVIDER_KIND_[A-Z_]+ = "([a-z_]+)"/g)].map(
    (match) => match[1] ?? '',
  )
}

describe('接入形态三方逐字一致', () => {
  const platform = [
    ...new Set(kindLiterals(readFileSync(PLATFORM_ENUMS, 'utf8'))),
  ].sort()

  it('确实读到了平台那份清单（读不到就等于这条闸没跑）', () => {
    expect(platform.length).toBeGreaterThan(0)
  })

  it('前端与平台一致', () => {
    expect([...LLM_PROVIDER_KINDS].sort()).toEqual(platform)
  })

  it('llmcore 与平台一致', () => {
    // ⚠ 两个消费方按它挑适配器（ADR-0041）：llmcore 少一种的话，那一路在
    // 两侧都如实缺席，而「缺席」在界面上看起来与「还没配」一模一样
    const shared = [
      ...new Set(kindLiterals(readFileSync(LLMCORE_CATALOG, 'utf8'))),
    ].sort()
    expect(shared).toEqual(platform)
  })

  it('助手认得出平台登记的每一种', () => {
    // ⚠ 端点与推理档位那几样从 llmcore 再导出，订阅那一形态在助手自己那份
    // ports 里也复述一份
    const assistant = [
      ...new Set([
        ...kindLiterals(readFileSync(ASSISTANT_PORTS, 'utf8')),
        ...kindLiterals(readFileSync(LLMCORE_CATALOG, 'utf8')),
      ]),
    ].sort()
    expect(assistant).toEqual(platform)
  })

  it('迁移里写死的 CHECK 集合与平台清单一致', () => {
    // ⚠ 迁移是冻结件、活常量是活的：加一种形态时两边都要动，这里就是那道红灯
    const source = readFileSync(KIND_MIGRATION, 'utf8')
    const block = /KINDS = "(.*?)"/.exec(source)?.[1] ?? ''
    const listed = [...block.matchAll(/'([a-z_]+)'/g)]
      .map((match) => match[1] ?? '')
      .sort()
    expect(listed).toEqual(platform)
  })
})
