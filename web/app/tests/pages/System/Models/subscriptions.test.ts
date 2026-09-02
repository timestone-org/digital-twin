/**
 * @fileoverview 哪几路要摆登录面板。
 *
 * 守两件在界面上完全看不出来的事：按形态判而不是按名字猜（形态是后端下发的，
 * 与后端校验同源）；目录里没有订阅型供应商时还要认环境变量那一路——不认的话，
 * 一套按老办法配好的部署在这一页上完全找不到登录入口，而助手那边说着
 * 「这一路没登录」。
 */
import { describe, expect, it } from 'vitest'
import type { LlmProvider, LlmProviderKind } from '@dt/contracts'

import { subscriptionAccounts } from '@/pages/System/Models/scripts/subscriptions'

const KINDS: LlmProviderKind[] = [
  {
    code: 'openai_compat',
    label: 'OpenAI 兼容端点',
    description: '',
    is_endpoint_required: true,
    is_login_required: false,
    model_kinds: ['chat', 'embedding'],
    consumers: ['assistant', 'knowledge'],
    efforts: [],
    presets: [],
  },
  {
    code: 'codex_oauth',
    label: 'Codex 订阅',
    description: '',
    is_endpoint_required: false,
    is_login_required: true,
    model_kinds: ['chat'],
    consumers: ['assistant'],
    efforts: ['low'],
    presets: [],
  },
]

function provider(over: Partial<LlmProvider> = {}): LlmProvider {
  return {
    id: 'p1',
    name: '百炼',
    kind: 'openai_compat',
    base_url: 'https://endpoint/v1',
    api_key_hint: '…1234',
    is_enabled: true,
    extra_body: null,
    options: null,
    models: [],
    notes: '',
    assigned_purposes: [],
    updated_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

describe('要登录的那几路', () => {
  it('端点那一形态不摆登录面板', () => {
    expect(subscriptionAccounts([provider()], KINDS, [])).toEqual([])
  })

  it('目录里每一路订阅账号各摆一份，键是那一路的 id', () => {
    const listed = subscriptionAccounts(
      [
        provider(),
        provider({ id: 'p2', name: '我的 Codex', kind: 'codex_oauth' }),
        provider({ id: 'p3', name: '同事的 Codex', kind: 'codex_oauth' }),
      ],
      KINDS,
      [],
    )
    expect(listed).toEqual([
      { ref: 'p2', name: '我的 Codex', isFromCatalog: true },
      { ref: 'p3', name: '同事的 Codex', isFromCatalog: true },
    ])
  })

  it('目录里没有订阅型时认环境变量那一路', () => {
    const listed = subscriptionAccounts([provider()], KINDS, [
      'default',
      'codex',
    ])
    expect(listed).toEqual([
      { ref: 'codex', name: '订阅账号（环境变量）', isFromCatalog: false },
    ])
  })

  it('目录里配了订阅型就不再摆环境变量那一路', () => {
    // ⚠ 两路并排摆着的话，人会看到两个「订阅账号」，而其中一个是配置文件里的影子
    const listed = subscriptionAccounts(
      [provider({ id: 'p2', name: '我的 Codex', kind: 'codex_oauth' })],
      KINDS,
      ['codex'],
    )
    expect(listed.map((one) => one.ref)).toEqual(['p2'])
  })

  it('助手没接订阅那一路时什么都不摆', () => {
    expect(subscriptionAccounts([], KINDS, ['default'])).toEqual([])
  })
})
