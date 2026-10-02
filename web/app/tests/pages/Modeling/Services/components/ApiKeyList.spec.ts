/**
 * @fileoverview 服务密钥用途长文本与撤销动作。
 */
import type { ModelApiKey } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ApiKeyList from '@/pages/Modeling/Services/components/ApiKeyList.vue'

const KEY: ModelApiKey = {
  id: 'k1',
  deployment_id: 'd1',
  name: 'N'.repeat(128),
  key_prefix: 'dtmk_abc123',
  expires_at: null,
  revoked_at: null,
  last_used_at: null,
  created_by_name: null,
  created_at: '2026-01-01T00:00:00.000Z',
}

function open(row: ModelApiKey = KEY) {
  return mount(ApiKeyList, {
    props: { rows: [row] },
    global: {
      stubs: { PermGuard: { props: ['codes'], template: '<slot />' } },
    },
  })
}

describe('服务密钥用途长文本', () => {
  it('长用途在列内截断并保留完整提示，撤销仍返回原密钥', async () => {
    const wrapper = open()
    const name = wrapper.findAll('tbody td')[0]?.find('[title]')
    expect(name?.exists()).toBe(true)
    expect(name?.text()).toBe(KEY.name)
    expect(name?.attributes('title')).toBe(KEY.name)
    expect(name?.classes()).toEqual(
      expect.arrayContaining(['block', 'truncate']),
    )
    const revoke = wrapper
      .findAll('button')
      .find((button) => button.text() === '撤销')
    expect(revoke).toBeDefined()
    await revoke?.trigger('click')
    expect(wrapper.emitted('revoke')).toEqual([[KEY]])
    wrapper.unmount()
  })

  it('已撤销的密钥保持状态且不再显示撤销动作', () => {
    const wrapper = open({ ...KEY, revoked_at: KEY.created_at })
    expect(wrapper.text()).toContain('已撤销')
    expect(
      wrapper.findAll('button').some((button) => button.text() === '撤销'),
    ).toBe(false)
    wrapper.unmount()
  })
})
