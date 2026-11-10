/** @fileoverview 模型目录状态：改用途之后供应商身上的「被谁指着」要跟着变。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmProvider, LlmPurpose } from '@dt/contracts'

import * as assistantApi from '@/api/assistant'
import * as knowledgeApi from '@/api/knowledge'
import * as llm from '@/api/llmProviders'
import { useModelCatalog } from '@/pages/System/Models/scripts/useModelCatalog'

function provider(id: string, assigned: string[]): LlmProvider {
  return {
    id,
    name: id,
    kind: 'openai_compat',
    base_url: 'https://endpoint/v1',
    api_key_hint: '…1234',
    is_enabled: true,
    extra_body: null,
    options: null,
    models: [],
    notes: '',
    assigned_purposes: assigned,
    updated_by: null,
    created_at: '',
    updated_at: '',
  }
}

function purpose(code: string, providerId: string | null): LlmPurpose {
  return {
    purpose: code,
    label: code,
    description: '',
    kind: 'chat',
    consumer: 'assistant',
    is_vision_required: false,
    has_env_default: true,
    provider_id: providerId,
    provider_name: providerId,
    model_name: providerId === null ? null : 'm',
    updated_at: null,
  }
}

beforeEach(() => {
  vi.spyOn(llm, 'listProviders').mockResolvedValue({
    items: [provider('p1', ['assistant.chat']), provider('p2', [])],
    page: 1,
    size: 200,
    total: 2,
  })
  vi.spyOn(llm, 'listKinds').mockResolvedValue([])
  vi.spyOn(llm, 'listPurposes').mockResolvedValue([
    purpose('assistant.chat', 'p1'),
  ])
  vi.spyOn(assistantApi, 'probeCapability').mockRejectedValue(new Error('x'))
  vi.spyOn(knowledgeApi, 'readCapability').mockRejectedValue(new Error('x'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useModelCatalog', () => {
  it('清掉唯一用途后那一路不再显示被指着', async () => {
    vi.spyOn(llm, 'clearPurpose').mockResolvedValue()
    const catalog = useModelCatalog()
    await catalog.reload()
    await catalog.clear('assistant.chat')
    const p1 = catalog.providers.value.find((one) => one.id === 'p1')
    expect(p1?.assigned_purposes).toEqual([])
  })

  it('把用途指给另一路后两路的计数一起换', async () => {
    vi.spyOn(llm, 'assignPurpose').mockResolvedValue(
      purpose('assistant.chat', 'p2'),
    )
    const catalog = useModelCatalog()
    await catalog.reload()
    await catalog.assign('assistant.chat', 'p2', 'm')
    const byId = new Map(
      catalog.providers.value.map((one) => [one.id, one.assigned_purposes]),
    )
    expect(byId.get('p1')).toEqual([])
    expect(byId.get('p2')).toEqual(['assistant.chat'])
  })
})
