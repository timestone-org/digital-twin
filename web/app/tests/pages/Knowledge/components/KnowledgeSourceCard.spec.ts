/** @fileoverview 来源卡片：种类用中文说，不把内部代号 platform 摆给人看。 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import KnowledgeSourceCard from '@/pages/Knowledge/components/KnowledgeSourceCard.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('KnowledgeSourceCard', () => {
  it('平台来源写「平台接口」而不是 platform', () => {
    const wrapper = mount(KnowledgeSourceCard, {
      props: {
        source: {
          id: 's1',
          baseId: 'b1',
          kind: 'platform',
          name: '台账',
          config: { path: '/api/v1/platform/dataset-tables' },
          lastSyncedAt: null,
          lastError: '',
        },
        isBusy: false,
        isLoading: false,
      },
    })
    expect(wrapper.text()).toContain('平台接口')
    expect(wrapper.text()).not.toMatch(/^platform$/m)
  })
})
