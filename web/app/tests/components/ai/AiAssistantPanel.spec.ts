/**
 * @fileoverview 契约：面板一直摆着「保存要你自己按」，且发送后立刻看得见自己说的话。
 *
 * 漏了那句提醒，用户会以为助手绑完就落库了，然后关掉标签页——而草稿只在内存里。
 */
import { mount } from '@vue/test-utils'
import { DtFilePicker } from '@dt/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AiAssistantPanel from '@/components/ai/AiAssistantPanel.vue'
import { __resetAiPorts, setAiPorts } from '@/features/ai/ports'

// 附点表这一路打的是真接口，用例里换成假件——它验的是「读出来的表去了哪」，
// 不是解析本身（那一半由后端的用例守）
vi.mock('@/api/assistant', () => ({
  parseAttachment: vi.fn((filename: string) => {
    if (!filename.endsWith('.csv')) return Promise.reject(new Error('只认得 .csv'))
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

function mountPanel(sessionId: string | null = 's1') {
  return mount(AiAssistantPanel, {
    props: {
      surfaceKind: 'dashboard-editor' as const,
      surfaceLabel: '大屏编辑器',
      sessionId,
      hint: '助手改的是草稿，保存要你自己按。',
    },
  })
}

afterEach(() => {
  __resetAiPorts()
})

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
    const buttons = wrapper.findAll('button')
    const fold = buttons.find((one) => one.text().includes('收起'))
    await fold?.trigger('click')
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

describe('附点表', () => {
  it('读出来的表附进草稿，而不是直接发出去', async () => {
    // 用户得先看见助手将要看到什么
    const wrapper = mountPanel()
    pick(wrapper, new File(['code,name\na,温度\n'], '点表.csv'))
    await vi.waitFor(() => {
      expect(wrapper.find('textarea').element.value).toContain('点表.csv')
    })
    expect(wrapper.find('textarea').element.value).toContain('code | name')
  })

  it('读不了的文件如实报错，不静默吞掉', async () => {
    const wrapper = mountPanel()
    pick(wrapper, new File(['%PDF'], '手册.pdf'))
    await vi.waitFor(() => {
      expect(wrapper.text()).toMatch(/csv|读不了/)
    })
  })
})
