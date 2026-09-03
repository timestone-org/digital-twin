/**
 * @fileoverview 输入区接麦克风的契约：接了语音识别才有键；键的读屏名与 pressed 随
 * 录音态走；转写接在开始录音那一刻的草稿后面并整体覆盖；Esc 作废；出错摆一条
 * 提示；反问期间麦克风与文本框一起禁；整理完焦点回到文本框。
 * 状态机本身由 `features/speech/useSpeechInput.test.ts` 守，这里把它换成假的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'

import KnowledgeChatComposer from '@/pages/KnowledgeChat/components/KnowledgeChatComposer.vue'
import type { SpeechStatus } from '@/features/speech/useSpeechInput'

const fake = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
}))

let status: Ref<SpeechStatus>
let transcript: Ref<string>
let error: Ref<string>

vi.mock('@/features/speech/useSpeechInput', () => ({
  useSpeechInput: () => ({ status, transcript, error, ...fake }),
}))

beforeEach(() => {
  status = ref<SpeechStatus>('idle')
  transcript = ref('')
  error = ref('')
  fake.start.mockReset()
  fake.stop.mockReset()
  fake.cancel.mockReset()
})

enableAutoUnmount(afterEach)

afterEach(() => {
  document.body.innerHTML = ''
})

function render(
  props: Partial<{
    running: boolean
    asking: boolean
    speechEnabled: boolean
  }> = {},
): VueWrapper {
  return mount(KnowledgeChatComposer, {
    props: {
      running: false,
      asking: false,
      speechEnabled: true,
      bases: [],
      scope: null,
      ...props,
    },
    attachTo: document.body,
  })
}

const mic = (wrapper: VueWrapper) =>
  wrapper.find(
    'button[aria-label="开始语音输入"], button[aria-label="结束语音输入"]',
  )

describe('麦克风键', () => {
  it('没接语音识别就没有这枚键', () => {
    const wrapper = render({ speechEnabled: false })

    expect(mic(wrapper).exists()).toBe(false)
  })

  it('接了就有，读屏名说清是开始', () => {
    const wrapper = render()

    expect(mic(wrapper).attributes('aria-label')).toBe('开始语音输入')
    expect(mic(wrapper).attributes('aria-pressed')).toBe('false')
  })

  it('点一下开始录，录着时是按下态、读屏名变成结束、旁边说正在听', async () => {
    const wrapper = render()

    await mic(wrapper).trigger('click')
    expect(fake.start).toHaveBeenCalledTimes(1)

    status.value = 'listening'
    await nextTick()
    expect(mic(wrapper).attributes('aria-label')).toBe('结束语音输入')
    expect(mic(wrapper).attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('正在听')

    await mic(wrapper).trigger('click')
    expect(fake.stop).toHaveBeenCalledTimes(1)
  })

  it('整理中时键禁着、旁边说整理中', async () => {
    const wrapper = render()
    status.value = 'finishing'
    await nextTick()

    expect(mic(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('整理中')
  })

  it('正等用户在卡片上回答时麦克风与文本框一起禁', () => {
    const wrapper = render({ asking: true })

    expect(mic(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
  })
})

describe('转写进草稿', () => {
  it('接在开始录音那一刻的草稿后面，中间补一个空格，每帧整体覆盖', async () => {
    const wrapper = render()
    await wrapper.find('textarea').setValue('前面')
    await mic(wrapper).trigger('click')
    status.value = 'listening'

    transcript.value = '冷却水'
    await nextTick()
    expect(wrapper.find<HTMLTextAreaElement>('textarea').element.value).toBe(
      '前面 冷却水',
    )

    transcript.value = '冷却水出口温度'
    await nextTick()
    expect(wrapper.find<HTMLTextAreaElement>('textarea').element.value).toBe(
      '前面 冷却水出口温度',
    )
  })

  it('草稿以换行结尾时不再补空格；草稿为空时也不补', async () => {
    const wrapper = render()
    await wrapper.find('textarea').setValue('前面\n')
    await mic(wrapper).trigger('click')
    transcript.value = '冷却水'
    await nextTick()
    expect(wrapper.find<HTMLTextAreaElement>('textarea').element.value).toBe(
      '前面\n冷却水',
    )

    status.value = 'idle'
    await wrapper.find('textarea').setValue('')
    await mic(wrapper).trigger('click')
    transcript.value = '润滑'
    await nextTick()
    expect(wrapper.find<HTMLTextAreaElement>('textarea').element.value).toBe(
      '润滑',
    )
  })

  it('作废后转写清空，草稿回到开始录音那一刻', async () => {
    const wrapper = render()
    await wrapper.find('textarea').setValue('前面')
    await mic(wrapper).trigger('click')
    status.value = 'listening'
    transcript.value = '冷却水'
    await nextTick()

    transcript.value = ''
    status.value = 'idle'
    await nextTick()

    expect(wrapper.find<HTMLTextAreaElement>('textarea').element.value).toBe(
      '前面 ',
    )
  })

  it('整理完了焦点回到文本框', async () => {
    const wrapper = render()
    status.value = 'finishing'
    await nextTick()

    status.value = 'idle'
    await nextTick()

    expect(document.activeElement).toBe(wrapper.find('textarea').element)
  })
})

describe('键盘', () => {
  it('录音中按 Esc 等于作废；没在录时 Esc 放行', async () => {
    const wrapper = render()
    await wrapper.find('textarea').trigger('keydown', { key: 'Escape' })
    expect(fake.cancel).not.toHaveBeenCalled()

    status.value = 'listening'
    await nextTick()
    await wrapper.find('textarea').trigger('keydown', { key: 'Escape' })

    expect(fake.cancel).toHaveBeenCalledTimes(1)
  })

  it('录着时 Enter 照样能把手上的草稿发出去', async () => {
    const wrapper = render()
    status.value = 'listening'
    await wrapper.find('textarea').setValue('上限多少')

    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('send')?.[0]).toEqual(['上限多少'])
  })
})

describe('出错', () => {
  it('错误摆在输入框上方，读屏按 alert 打断', async () => {
    const wrapper = render()
    error.value = '这套部署的语音识别此刻不可用'
    await nextTick()

    const notice = wrapper.find('[role="alert"]')

    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('这套部署的语音识别此刻不可用')
  })

  it('没出错时没有那条提示', () => {
    const wrapper = render()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
