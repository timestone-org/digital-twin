/**
 * @fileoverview 契约：面板一直摆着「保存要你自己按」；发送后立刻看得见自己说的话；
 * 附件先挂成待发条目、点开能核对全文，发送时才并进那句话。
 *
 * 漏了那句提醒，用户会以为助手绑完就落库了，然后关掉标签页——而草稿只在内存里。
 */
import { mount } from '@vue/test-utils'
import { DtFilePicker } from '@dt/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

import AiAssistantPanel from '@/components/ai/AiAssistantPanel.vue'
import { useAiConversation } from '@/composables/useAiConversation'
import { newComposeState } from '@/composables/useAiPanel'
import { __resetAskHandler, askUser } from '@/features/ai/askBridge'
import { __resetAiPorts, setAiPorts } from '@/features/ai/ports'

// 附文件这一路打的是真接口，用例里换成假件——它验的是「读出来的内容去了哪」，
// 不是解析本身（那一半由后端的用例守）
vi.mock('@/api/assistant', () => ({
  parseAttachment: vi.fn((filename: string) => {
    if (filename.endsWith('.txt'))
      return Promise.resolve({
        columns: [],
        rows: [],
        is_truncated: false,
        total_rows: 2,
        text: '上午一切正常\n下午停机',
      })
    if (!filename.endsWith('.csv'))
      return Promise.reject(new Error('只认得表格或纯文本'))
    return Promise.resolve({
      columns: ['code', 'name'],
      rows: [['a', '温度']],
      is_truncated: false,
      total_rows: 1,
      text: 'code | name\na | 温度',
    })
  }),
}))

/** 走 DtFilePicker 的 `select` 事件，与用户真的挑一个文件同一条路。 */
function pick(wrapper: ReturnType<typeof mountPanel>, file: File): void {
  wrapper.findComponent(DtFilePicker).vm.$emit('select', [file])
}

// 对话归 useAiPanel 持有、按 prop 传进来；用例里在独立作用域造一段真的
let scope: EffectScope | null = null

function mountPanel(sessionId: string | null = 's1', starters?: string[]) {
  scope = effectScope()
  const chat = scope.run(() =>
    useAiConversation(
      () => sessionId,
      () => ({ kind: 'dashboard-editor', label: '大屏编辑器' }),
    ),
  )
  if (chat === undefined) throw new Error('对话没造出来')
  const compose = newComposeState()
  const wrapper = mount(AiAssistantPanel, {
    props: {
      chat,
      compose,
      surfaceLabel: '大屏编辑器',
      hint: '助手改的是草稿，保存要你自己按。',
      ...(starters === undefined ? {} : { starters }),
    },
  })
  return Object.assign(wrapper, { compose, chat })
}

afterEach(() => {
  scope?.stop()
  scope = null
  __resetAiPorts()
  __resetAskHandler()
})

const ASK = {
  question: '这一格的值从哪来？',
  options: [
    { value: 'opcua', label: '实时点位' },
    { value: 'dataset', label: '台账列' },
  ],
  allow_multiple: false,
  allow_free_text: false,
  free_text_label: null,
}

describe('助手面板', () => {
  it('没说过话时给一句引导，而不是一片空白', () => {
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('说说你想做什么')
  })

  it('一直摆着「保存要你自己按」', () => {
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('保存要你自己按')
  })

  it('摆出当前在哪一页', () => {
    const wrapper = mountPanel()
    expect(wrapper.text()).toContain('大屏编辑器')
  })

  it('收起按钮往外报一声', async () => {
    const wrapper = mountPanel()
    await wrapper.find('button[aria-label="收起助手面板"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('没装口子时发消息如实说不可用', async () => {
    const wrapper = mountPanel()
    await wrapper.find('textarea').setValue('帮我绑点')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('不可用')
    })
  })

  it('发出去的话立刻出现在流里', async () => {
    setAiPorts({
      // 只吐一块空文本：解不出任何帧，于是这条用例只看「我说的话有没有立刻
      // 出现在流里」，不掺助手怎么答
      advance: async function* () {
        await Promise.resolve()
        yield ''
      },
    })
    const wrapper = mountPanel()
    await wrapper.find('textarea').setValue('帮我绑点')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('帮我绑点')
    })
  })
})

describe('聊天快捷键', () => {
  it('Enter 直接发送', async () => {
    setAiPorts({
      advance: async function* () {
        await Promise.resolve()
        yield ''
      },
    })
    const wrapper = mountPanel()
    await wrapper.find('textarea').setValue('帮我绑点')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('帮我绑点')
    })
  })

  it('IME 组合中的 Enter 是在选字，不发送', async () => {
    const wrapper = mountPanel()
    await wrapper.find('textarea').setValue('wen du')
    await wrapper
      .find('textarea')
      .trigger('keydown', { key: 'Enter', isComposing: true })
    // 草稿还在，说明没发出去
    expect(
      (wrapper.find('textarea').element as HTMLTextAreaElement).value,
    ).toBe('wen du')
  })

  it('草稿为空时 ↑ 召回上一句自己说的话', async () => {
    setAiPorts({
      advance: async function* () {
        await Promise.resolve()
        yield ''
      },
    })
    const wrapper = mountPanel()
    await wrapper.find('textarea').setValue('把温度绑上去')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('把温度绑上去')
    })
    await wrapper.find('textarea').trigger('keydown', { key: 'ArrowUp' })
    expect(
      (wrapper.find('textarea').element as HTMLTextAreaElement).value,
    ).toBe('把温度绑上去')
  })

  it('Esc 在闲着时收起面板', async () => {
    const wrapper = mountPanel()
    await wrapper.find('aside').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('空态开场', () => {
  it('点一句开场是填进草稿，不是直接发出去', async () => {
    const wrapper = mountPanel('s1', ['把温度绑到数值卡上'])
    const starter = wrapper
      .findAll('button')
      .find((one) => one.text() === '把温度绑到数值卡上')
    await starter?.trigger('click')
    expect(
      (wrapper.find('textarea').element as HTMLTextAreaElement).value,
    ).toBe('把温度绑到数值卡上')
    // 还在空态：没有发出去任何话
    expect(wrapper.text()).toContain('说说你想做什么')
  })
})

describe('附文件', () => {
  it('读出来的表挂成待发附件，点开能核对全文', async () => {
    // 用户得先看见助手将要看到什么
    const wrapper = mountPanel()
    pick(wrapper, new File(['code,name\na,温度\n'], '点表.csv'))
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('点表.csv')
    })
    expect(wrapper.text()).toContain('2 列 × 1 行')
    const head = wrapper.find('.ai-file__head')
    await head.trigger('click')
    expect(wrapper.text()).toContain('code | name')
  })

  it('纯文本文件同样收，不再只认点表', async () => {
    const wrapper = mountPanel()
    pick(wrapper, new File(['上午一切正常'], '巡检.txt'))
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('巡检.txt')
    })
    expect(wrapper.text()).toContain('2 行')
  })

  it('发送时附件并进那句话，随后清空待发区', async () => {
    setAiPorts({
      advance: async function* () {
        await Promise.resolve()
        yield ''
      },
    })
    const wrapper = mountPanel()
    pick(wrapper, new File(['code,name\na,温度\n'], '点表.csv'))
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('点表.csv')
    })
    await wrapper.find('textarea').setValue('照这张表绑')
    await wrapper.find('form').trigger('submit')
    // 时间线上自己那条气泡里带着正文与附件——发给模型的就是这段
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('照这张表绑')
    })
    expect(wrapper.text()).toContain('参考文件 点表.csv')
    expect(wrapper.text()).toContain('code | name')
    expect(wrapper.find('.ai-file__head').exists()).toBe(false)
  })

  it('待发附件能移除', async () => {
    const wrapper = mountPanel()
    pick(wrapper, new File(['code\na\n'], '点表.csv'))
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('点表.csv')
    })
    await wrapper
      .find('button[aria-label="移除附件 点表.csv"]')
      .trigger('click')
    expect(wrapper.find('.ai-file__head').exists()).toBe(false)
  })

  it('读不了的文件如实报错，不静默吞掉', async () => {
    const wrapper = mountPanel()
    pick(wrapper, new File(['%PDF'], '手册.pdf'))
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('只认得')
    })
  })
})

describe('助手问用户拿主意', () => {
  it('提问摆成一张可点的卡片，问题与选项都在上面', async () => {
    const wrapper = mountPanel()
    void askUser(ASK)
    await vi.waitFor(() => {
      expect(wrapper.find('.ai-ask').exists()).toBe(true)
    })
    expect(wrapper.text()).toContain('这一格的值从哪来？')
    expect(wrapper.findAll('.ai-ask__option')).toHaveLength(2)
  })

  it('待回答期间输入框锁着', async () => {
    // 不锁的话用户的新消息会与正在跑的回合抢同一条时间线，谁后到谁覆盖
    const wrapper = mountPanel()
    void askUser(ASK)
    await vi.waitFor(() => {
      expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
    })
  })

  it('点一个选项就把答案交回去，卡片就地收起，输入框解禁', async () => {
    const wrapper = mountPanel()
    const pending = askUser(ASK)
    await vi.waitFor(() => {
      expect(wrapper.find('.ai-ask__option').exists()).toBe(true)
    })

    await wrapper.findAll('.ai-ask__option')[1]?.trigger('click')

    await expect(pending).resolves.toEqual({
      picked: ['dataset'],
      free_text: null,
      is_cancelled: false,
    })
    await vi.waitFor(() => {
      expect(wrapper.find('.ai-ask__option').exists()).toBe(false)
    })
    expect(wrapper.text()).toContain('你选了：台账列')
    expect(wrapper.find('textarea').attributes('disabled')).toBeUndefined()
  })

  it('「我自己说」回一条取消，输入框随即解禁', async () => {
    const wrapper = mountPanel()
    const pending = askUser(ASK)
    await vi.waitFor(() => {
      expect(wrapper.find('.ai-ask__mine').exists()).toBe(true)
    })

    await wrapper.find('.ai-ask__mine').trigger('click')

    // 取消是正常回执：回合据它继续往下走，不是一条失败
    await expect(pending).resolves.toMatchObject({ is_cancelled: true })
    await vi.waitFor(() => {
      expect(wrapper.find('textarea').attributes('disabled')).toBeUndefined()
    })
  })

  it('掐掉回合时挂着的提问被结成取消', async () => {
    const wrapper = mountPanel()
    const pending = askUser(ASK)
    await vi.waitFor(() => {
      expect(wrapper.find('.ai-ask').exists()).toBe(true)
    })

    wrapper.chat.stop()

    await expect(pending).resolves.toMatchObject({ is_cancelled: true })
    await vi.waitFor(() => {
      expect(wrapper.find('textarea').attributes('disabled')).toBeUndefined()
    })
  })

  it('卸载时挂着的提问也被结掉，回合不留在半路上', async () => {
    const wrapper = mountPanel()
    const pending = askUser(ASK)
    await vi.waitFor(() => {
      expect(wrapper.find('.ai-ask').exists()).toBe(true)
    })

    scope?.stop()
    await expect(pending).resolves.toMatchObject({ is_cancelled: true })
  })
})
