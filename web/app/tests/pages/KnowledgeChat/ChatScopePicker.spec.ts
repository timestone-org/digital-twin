/**
 * @fileoverview 范围选择器的契约：默认「全部知识库」、勾选发出的是 id 表、
 * 「全部」发的是 null、最后一个勾禁掉、已删的库照样列出来。
 *
 * ⚠ 模板里的 prop 名、插槽名、图标名写错，typecheck 与 lint 双双放行——
 * 这个文件是唯一的防线。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount, type VueWrapper } from '@vue/test-utils'
import type { KnowledgeChatScopeBase } from '@dt/contracts'

import type { KnowledgeBase } from '@/api/knowledge'
import ChatScopePicker from '@/pages/KnowledgeChat/components/ChatScopePicker.vue'

function baseOf(id: string, name: string): KnowledgeBase {
  return {
    id,
    name,
    description: '',
    strategy: 'hybrid',
    embeddingModel: null,
    dimensions: null,
    documentCount: 0,
    createdAt: '',
  }
}

const BASES = [baseOf('b1', '手册库'), baseOf('b2', '规程库')]

enableAutoUnmount(afterEach)

afterEach(() => {
  document.body.innerHTML = ''
})

function render(
  scope: KnowledgeChatScopeBase[] | null,
  disabled = false,
): VueWrapper {
  return mount(ChatScopePicker, {
    props: { bases: BASES, scope, disabled },
    attachTo: document.body,
  })
}

/** 展开面板。DtPopover 用 Teleport，面板不在 wrapper 的子树里。 */
async function open(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('button.chat-scope__trigger').trigger('click')
}

function boxByLabel(label: string): HTMLInputElement {
  const found = [...document.querySelectorAll('label')].find((node) =>
    node.textContent?.includes(label),
  )
  const box = found?.querySelector('input[type="checkbox"]')
  if (!(box instanceof HTMLInputElement)) {
    throw new Error(`面板里没有「${label}」`)
  }
  return box
}

function emitted(wrapper: VueWrapper): unknown[][] {
  return wrapper.emitted('change') ?? []
}

describe('触发器', () => {
  it('默认写「全部知识库」', () => {
    const wrapper = render(null)

    expect(wrapper.get('button.chat-scope__trigger').text()).toContain(
      '全部知识库',
    )
  })

  it('收窄之后写选中的那个库', () => {
    const wrapper = render([
      { base_id: 'b1', name: '手册库', is_missing: false },
    ])

    expect(wrapper.get('button.chat-scope__trigger').text()).toContain('手册库')
  })

  it('⚠ 回合跑着时禁掉：改了这一轮已经发出去的工具还按旧范围跑', () => {
    const wrapper = render(null, true)

    expect(
      wrapper.get('button.chat-scope__trigger').attributes('disabled'),
    ).toBeDefined()
  })
})

describe('面板里勾选', () => {
  it('不限库时每个库都是勾上的', async () => {
    const wrapper = render(null)

    await open(wrapper)

    expect(boxByLabel('手册库').checked).toBe(true)
    expect(boxByLabel('全部知识库').checked).toBe(true)
  })

  it('取消一个库，发出去的是剩下那几个的 id', async () => {
    const wrapper = render(null)
    await open(wrapper)

    boxByLabel('手册库').click()

    expect(emitted(wrapper)[0]).toEqual([['b2']])
  })

  it('点「全部知识库」发的是 null 而不是全部 id', async () => {
    const wrapper = render([
      { base_id: 'b1', name: '手册库', is_missing: false },
    ])
    await open(wrapper)

    boxByLabel('全部知识库').click()

    expect(emitted(wrapper)[0]).toEqual([null])
  })

  it('⚠ 只剩一个勾时禁掉它：清空不许变成「全部」', async () => {
    const wrapper = render([
      { base_id: 'b1', name: '手册库', is_missing: false },
    ])

    await open(wrapper)

    expect(boxByLabel('手册库').disabled).toBe(true)
    expect(boxByLabel('规程库').disabled).toBe(false)
  })

  it('⚠ 范围里被删掉的库照样列出来：抹掉等于替他把边界改宽', async () => {
    const wrapper = render([
      { base_id: 'b1', name: '手册库', is_missing: false },
      { base_id: 'b9', name: '', is_missing: true },
    ])

    await open(wrapper)

    expect(document.body.textContent).toContain('已不存在')
    expect(document.body.textContent).toContain('b9')
  })

  it('一个库都没有时说清这套部署还没建过库', async () => {
    const wrapper = mount(ChatScopePicker, {
      props: { bases: [], scope: null, disabled: false },
      attachTo: document.body,
    })

    await open(wrapper)

    expect(document.body.textContent).toContain('这套部署还没有知识库')
  })
})
