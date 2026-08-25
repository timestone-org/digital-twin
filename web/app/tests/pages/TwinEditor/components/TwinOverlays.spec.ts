/**
 * @fileoverview 契约：孪生编辑器的浮层只做转发，状态归页面。
 *
 * ⚠ 开关状态就地写 `bulk.open.value = $event` 是改 prop 上挂着的那只 ref——
 * 能跑，但状态的归属从此有两处。这一条由 eslint 的 `vue/no-mutating-props` 拦，
 * 而**改回来之后要有用例钉住上抛的那条事件真的接通了**，否则弹窗从此关不掉。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSION_CODES, type AssistantPlan } from '@dt/contracts'

import BulkPartsDialog from '@/pages/TwinEditor/components/BulkPartsDialog.vue'
import TwinOverlays from '@/pages/TwinEditor/components/TwinOverlays.vue'
import type { AiConversation, ChatEntry } from '@/composables/useAiConversation'
import type { AiPanel } from '@/composables/useAiPanel'
import type { BulkParts } from '@/pages/TwinEditor/scripts/useBulkParts'
import type { TwinBindings } from '@/pages/TwinEditor/scripts/useTwinBindings'
import { useAuthStore } from '@/stores/auth'

function bulk(): BulkParts {
  return {
    open: ref(true),
    candidates: computed(() => []),
    openBlank: vi.fn(),
  }
}

function binding(): TwinBindings {
  return {
    bindings: computed(() => []),
    write: vi.fn(),
    bind: vi.fn(),
    drop: vi.fn(),
    removeRow: vi.fn(),
    pickingFieldKey: ref<string | null>(null),
    pickPoint: vi.fn(),
    closePicker: vi.fn(),
    liveValues: computed(() => undefined),
    readBinding: () => () => ({ state: 'pending' }),
  }
}

function chat(): AiConversation {
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

function panel(isAvailable: boolean): AiPanel {
  return {
    isAvailable: ref(isAvailable),
    isOpen: ref(false),
    sessionId: ref<string | null>(null),
    chat: chat(),
    open: vi.fn(() => Promise.resolve()),
    close: vi.fn(),
  }
}

// PermGuard 读的是 auth store，没有 pinia 它在 setup 里就抛
beforeEach(() => {
  setActivePinia(createPinia())
  grant([PERMISSION_CODES.assistantUse])
})

// ⚠ 先把助手权限发下去。不发的话 PermGuard 会把整个入口挡在外面，
// 「入口不出现」那条断言就会因为一个不相干的理由恒真——探测那一档完全没被验到
function grant(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    username: 'u',
    role: { name: 'r' },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  } as never
  auth.accessToken = 'token'
}

function setup(isAvailable = false) {
  return mount(TwinOverlays, {
    props: { bulk: bulk(), binding: binding(), ai: panel(isAvailable) },
    global: { stubs: { teleport: true } },
  })
}

describe('批量加部件', () => {
  it('关弹窗是上抛，不是就地改 prop', async () => {
    const wrapper = setup()
    const dialog = wrapper.getComponent(BulkPartsDialog)
    dialog.vm.$emit('update:open', false)
    await nextTick()
    expect(wrapper.emitted('update:bulk-open')).toEqual([[false]])
    wrapper.unmount()
  })

  it('确认选中的部件名一路上抛给页面', async () => {
    const wrapper = setup()
    const dialog = wrapper.getComponent(BulkPartsDialog)
    dialog.vm.$emit('confirm', ['泵体', '阀门'])
    await nextTick()
    expect(wrapper.emitted('add-parts')).toEqual([[['泵体', '阀门']]])
    wrapper.unmount()
  })
})

// ⚠ 按钮只有图标没有文字，所以不能拿 `text()` 里有没有「助手」当断言——
// 那两档都找不到，用例恒绿。认可访问名才是这颗球存在与否的真凭据
const CALL = '[aria-label="打开 AI 助手"]'

describe('助手浮层', () => {
  it('这套部署没有助手时入口不出现', () => {
    const wrapper = setup(false)
    // 不是出现一个点了报错的按钮——某些现场根本不部署 ai-assistant
    expect(wrapper.find(CALL).exists()).toBe(false)
    wrapper.unmount()
  })

  it('探到了就把入口亮出来', () => {
    const wrapper = setup(true)
    expect(wrapper.find(CALL).exists()).toBe(true)
    wrapper.unmount()
  })

  it('没有 assistant:use 时，即使服务在也不出现', () => {
    grant([])
    const wrapper = setup(true)
    expect(wrapper.find(CALL).exists()).toBe(false)
    wrapper.unmount()
  })
})
