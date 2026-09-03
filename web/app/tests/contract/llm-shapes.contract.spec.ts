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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  LlmModel,
  LlmProbeResult,
  LlmProvider,
  LlmProviderKind,
  LlmProviderPreset,
  LlmPurpose,
  LlmRerankDialect,
} from '@dt/contracts'
import {
  LLM_MODEL_KINDS,
  LLM_PROVIDER_KINDS,
  LLM_PURPOSES,
  LLM_RERANK_DIALECTS,
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
// ⚠ 放宽用途码 CHECK 的那一次。迁移是**逐次叠加**的：只读第一份的话，
// 加一档用途之后这条闸会红在「平台多了一个」上，而库上其实认得它
const PURPOSE_MIGRATION = join(
  SERVER,
  'services',
  'platform-server',
  'migrations',
  'versions',
  '2026_09_03_1600-b6f4a20d75e1_add_rerank_purpose.py',
)
// ⚠ 扫整个目录而不是列文件名：列名单的话，加一路方言时新文件不在名单里，
// 这条闸对它一声不吭
const LLMCORE_RERANK_DIR = join(
  SERVER,
  'domain',
  'llmcore',
  'src',
  'llmcore',
  'rerank',
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
    rerank_dialects: true,
    presets: true,
  } satisfies Keys<LlmProviderKind>,
  LlmRerankDialectOut: {
    code: true,
    label: true,
    description: true,
  } satisfies Keys<LlmRerankDialect>,
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
    has_env_default: true,
    provider_id: true,
    provider_name: true,
    model_name: true,
    updated_at: true,
  } satisfies Keys<LlmPurpose>,
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
    // ⚠ 取的是**最后一次放宽**那一份：迁移逐次叠加，库上认的是最新那个集合
    const source = readFileSync(PURPOSE_MIGRATION, 'utf8')
    const block = /PURPOSES = \(([\s\S]*?)\n\)/.exec(source)?.[1] ?? ''
    const listed = [...block.matchAll(/'([a-z]+\.[a-z]+)'/g)]
      .map((match) => match[1] ?? '')
      .sort()
    expect(listed).toEqual(platform)
  })

  it('建表那一份的 CHECK 是这一份的子集（迁移只放宽不收窄）', () => {
    const source = readFileSync(MIGRATION, 'utf8')
    const block = /PURPOSES = \(([\s\S]*?)\n\)/.exec(source)?.[1] ?? ''
    const listed = [...block.matchAll(/'([a-z]+\.[a-z]+)'/g)].map(
      (match) => match[1] ?? '',
    )
    expect(listed.length).toBeGreaterThan(0)
    expect(listed.filter((one) => !platform.includes(one))).toEqual([])
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

  it('助手认得出平台登记的每一种', () => {
    // ⚠ 端点那一形态的名字在 llmcore（协议名，两个消费方共用），
    // 订阅那一形态的名字在助手自己那份 ports——认不出的形态如实缺席，
    // 而「缺席」在界面上看起来与「还没配」一模一样
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

/** 一份 Python 源码里 `X_DIALECT_Y = "…"` / `DIALECT_Y = "…"` 的取值。 */
function dialectLiterals(source: string): string[] {
  return [...source.matchAll(/DIALECT_[A-Z_]+ = "([a-z_]+)"/g)].map(
    (match) => match[1] ?? '',
  )
}

describe('重排线形三方逐字一致', () => {
  // ⚠ 平台配得出而调用侧没装的方言，表现是「界面上选得中、调用时说不认识」，
  // 而两边代码单看都对
  const platform = [
    ...new Set(dialectLiterals(readFileSync(PLATFORM_ENUMS, 'utf8'))),
  ].sort()

  it('确实读到了平台那份清单（读不到就等于这条闸没跑）', () => {
    expect(platform.length).toBeGreaterThan(0)
  })

  it('前端与平台一致', () => {
    expect([...LLM_RERANK_DIALECTS].sort()).toEqual(platform)
  })

  it('llmcore 装了平台登记的每一套', () => {
    const installed = [
      ...new Set(
        readdirSync(LLMCORE_RERANK_DIR)
          .filter((one) => one.endsWith('.py'))
          .flatMap((one) =>
            dialectLiterals(
              readFileSync(join(LLMCORE_RERANK_DIR, one), 'utf8'),
            ),
          ),
      ),
    ].sort()
    expect(installed).toEqual(platform)
  })
})
