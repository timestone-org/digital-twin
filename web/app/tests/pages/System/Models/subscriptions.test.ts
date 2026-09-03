/**
 * @fileoverview 哪几路要摆登录面板。
 *
 * 守两件在界面上完全看不出来的事：按形态判而不是按名字猜（形态是后端下发的，
 * 与后端校验同源）；只摆目录里的那几路——登录态挂在那一行供应商上（ADR-0041），
 * 目录之外的那一路无处存登录态，摆出来点下去是一条指不回任何地方的错。
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
    consumers: ['assistant', 'knowledge'],
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
    expect(subscriptionAccounts([provider()], KINDS)).toEqual([])
  })

  it('目录里每一路订阅账号各摆一份，键是那一路的 id', () => {
    const listed = subscriptionAccounts(
      [
        provider(),
        provider({ id: 'p2', name: '我的 Codex', kind: 'codex_oauth' }),
        provider({ id: 'p3', name: '同事的 Codex', kind: 'codex_oauth' }),
      ],
      KINDS,
    )
    expect(listed).toEqual([
      { ref: 'p2', name: '我的 Codex' },
      { ref: 'p3', name: '同事的 Codex' },
    ])
  })

  it('目录里一路订阅型都没有时什么都不摆', () => {
    // ⚠ 登录态挂在那一行供应商上：目录之外没有可挂的地方，摆出来的面板
    // 点下去是一条指不回任何地方的错
    expect(subscriptionAccounts([provider()], KINDS)).toEqual([])
    expect(subscriptionAccounts([], KINDS)).toEqual([])
  })
})
