/**
 * @fileoverview 契约：入口只在「有权限 + 这套部署有助手」时出现；
 * 收起时是机器人图标球，点一下走 open()，展开后球让位给面板。
 */
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { PERMISSION_CODES, type AssistantPlan } from '@dt/contracts'

import AiCoreIcon from '@/components/ai/AiCoreIcon.vue'
import AiDock from '@/components/ai/AiDock.vue'
import type { AiConversation, ChatEntry } from '@/composables/useAiConversation'
import { newComposeState, type AiPanel } from '@/composables/useAiPanel'
import { useAuthStore } from '@/stores/auth'

function fakeChat(): AiConversation {
  return {
    entries: computed<readonly ChatEntry[]>(() => []),
    isRunning: ref(false),
    plan: ref<AssistantPlan | null>(null),
    send: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    clear: vi.fn(),
    restore: vi.fn(),
    note: vi.fn(),
  }
}

function fakeAi(open = false, available = true): AiPanel {
  const isOpen = ref<boolean>(open)
  return {
    isAvailable: ref<boolean>(available),
    models: ref([]),
    choice: ref({ profile: '', effort: '' }),
    pickModel: vi.fn(() => Promise.resolve()),
    isOpen,
    sessionId: ref<string | null>(null),
    chat: fakeChat(),
    compose: newComposeState(),
    open: vi.fn(() => {
      isOpen.value = true
      return Promise.resolve()
    }),
    close: vi.fn(),
  }
}

function mountDock(ai: AiPanel) {
  return mount(AiDock, {
    props: {
      ai,
      surfaceLabel: '大屏编辑器',
      hint: '助手改的是草稿，保存要你自己按。',
    },
  })
}

function grant(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = { permissions: codes } as never
}

beforeEach(() => {
  setActivePinia(createPinia())
  grant([PERMISSION_CODES.assistantUse])
})

describe('AiDock', () => {
  it('收起时是带无障碍标签的机器人图标球', () => {
    const wrapper = mountDock(fakeAi())
    const call = wrapper.find('button[aria-label="打开 AI 助手"]')
    expect(call.exists()).toBe(true)
    expect(wrapper.findComponent(AiCoreIcon).exists()).toBe(true)
  })

  it('点球走 open()，展开后球让位给面板', async () => {
    const ai = fakeAi()
    const wrapper = mountDock(ai)
    await wrapper.find('button[aria-label="打开 AI 助手"]').trigger('click')
    expect(ai.open).toHaveBeenCalledTimes(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('button[aria-label="打开 AI 助手"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('aside').exists()).toBe(true)
  })

  it('这套部署没有助手时干净地不出现', () => {
    const wrapper = mountDock(fakeAi(false, false))
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('没权限时不出现，而不是出现一个点了报错的球', () => {
    grant([])
    const wrapper = mountDock(fakeAi())
    expect(wrapper.find('button').exists()).toBe(false)
  })
})

describe('⌘I 开合', () => {
  function press(init: KeyboardEventInit): void {
    window.dispatchEvent(new KeyboardEvent('keydown', init))
  }

  it('关着时 ⌘I 打开', () => {
    const ai = fakeAi()
    const wrapper = mountDock(ai)
    press({ key: 'i', metaKey: true })
    expect(ai.open).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('开着时 Ctrl+I 收起', () => {
    const ai = fakeAi(true)
    const wrapper = mountDock(ai)
    press({ key: 'i', ctrlKey: true })
    expect(ai.close).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('这套部署没有助手时 ⌘I 什么都不做', () => {
    const ai = fakeAi(false, false)
    const wrapper = mountDock(ai)
    press({ key: 'i', metaKey: true })
    expect(ai.open).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('卸载后不再吞别的页面的 ⌘I', () => {
    const ai = fakeAi()
    const wrapper = mountDock(ai)
    wrapper.unmount()
    press({ key: 'i', metaKey: true })
    expect(ai.open).not.toHaveBeenCalled()
  })
})
