/**
 * @fileoverview 分段编辑面的契约：受控、有序、增删移之后插入落点跟着挪。
 *
 * ⚠ 本组件**不留草稿**：一改就把整份草稿抛上去，父组件拼回同一行文本。留一份
 * 本地副本就会出现「界面上是这样、落库的是那样」。
 * ⚠ 增删移改的正是「第几档」，而插入落点记的也是「第几档.哪一格」。不跟着挪的
 * 话，下一次工具箱插入会落进**别的档**，或者落进一个已经不存在的档位——什么都
 * 没插进去，也什么都不报。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import FormulaBranchEditor from '@/pages/Dataset/TableDetail/components/FormulaBranchEditor.vue'
import type { BranchDraft } from '@/pages/Dataset/TableDetail/scripts/formulaText'

const DRAFT: BranchDraft = {
  arms: [
    { cond: '{a} > 8', value: '2' },
    { cond: '{a} > 6', value: '1' },
  ],
  otherwise: '0',
  form: 'IFS',
}

enableAutoUnmount(afterEach)

function open(draft: BranchDraft = DRAFT) {
  return mount(FormulaBranchEditor, { props: { draft } })
}

type Editor = ReturnType<typeof open>

function lastDraft(wrapper: Editor): BranchDraft | undefined {
  const events = wrapper.emitted('change')
  const payload = events?.[events.length - 1]?.[0]
  return payload as BranchDraft | undefined
}

async function clickLabelled(wrapper: Editor, label: string): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find((one) => one.attributes('aria-label') === label)
  if (button === undefined) throw new Error(`没有「${label}」这个按钮`)
  await button.trigger('click')
  await flushPromises()
}

describe('铺开', () => {
  it('每一档两格，兜底只有一格', () => {
    const boxes = open().findAll('textarea')
    expect(boxes.map((one) => one.element.value)).toEqual([
      '{a} > 8',
      '2',
      '{a} > 6',
      '1',
      '0',
    ])
  })

  it('第一档不能上移、最后一档不能下移', () => {
    const wrapper = open()
    const up = wrapper
      .findAll('button')
      .find((one) => one.attributes('aria-label') === '第 1 档上移')
    const down = wrapper
      .findAll('button')
      .find((one) => one.attributes('aria-label') === '第 2 档下移')
    expect(up?.attributes('disabled')).toBeDefined()
    expect(down?.attributes('disabled')).toBeDefined()
  })

  it('⚠ 兜底那一档没有增删移：它不是「条件恒真的一档」', () => {
    const labels = open()
      .findAll('button')
      .map((one) => one.attributes('aria-label') ?? '')
    expect(labels.filter((one) => one.includes('第 3 档'))).toEqual([])
  })
})

describe('受控', () => {
  it('改一格就把整份草稿抛上去，本地不留副本', async () => {
    const wrapper = open()
    await wrapper.findAll('textarea')[1]?.setValue('9')
    // 抛上去的是**整份**草稿，没动过的那几档原样带着，父组件据此重拼整行
    expect(lastDraft(wrapper)).toEqual({
      arms: [
        { cond: '{a} > 8', value: '9' },
        { cond: '{a} > 6', value: '1' },
      ],
      otherwise: '0',
      form: 'IFS',
    })
  })

  it('拼回时保留原本的 IF / IFS 写法', async () => {
    const wrapper = open()
    await wrapper.findAll('textarea')[4]?.setValue('-1')
    expect(lastDraft(wrapper)?.form).toBe('IFS')
  })

  it('加一档追加在末尾', async () => {
    const wrapper = open()
    const add = wrapper
      .findAll('button')
      .find((one) => one.text().trim() === '加一个分支')
    await add?.trigger('click')
    expect(lastDraft(wrapper)?.arms).toHaveLength(3)
    expect(lastDraft(wrapper)?.arms[2]).toEqual({ cond: '', value: '' })
  })

  it('删一档只删那一档，兜底不动', async () => {
    const wrapper = open()
    await clickLabelled(wrapper, '删除第 1 档')
    expect(lastDraft(wrapper)?.arms).toEqual([{ cond: '{a} > 6', value: '1' }])
    expect(lastDraft(wrapper)?.otherwise).toBe('0')
  })

  it('⚠ 顺序即语义：上下移换的是「第一个成立的是哪一档」', async () => {
    const wrapper = open()
    await clickLabelled(wrapper, '第 2 档上移')
    expect(lastDraft(wrapper)?.arms.map((one) => one.cond)).toEqual([
      '{a} > 6',
      '{a} > 8',
    ])
  })
})

describe('插入落点', () => {
  it('谁都没聚焦过时插进第一档的条件，而不是静默丢掉', async () => {
    const wrapper = open()
    await wrapper.vm.insert('{x}', 3)
    expect(lastDraft(wrapper)?.arms[0]?.cond).toBe('{x}{a} > 8')
  })

  it('插进最近聚焦的那一格', async () => {
    const wrapper = open()
    const box = wrapper.findAll('textarea')[3]
    box?.element.setSelectionRange(0, 1)
    await box?.trigger('select')
    await wrapper.vm.insert('{x}', 3)
    expect(lastDraft(wrapper)?.arms[1]?.value).toBe('{x}')
  })

  it('⚠ 删掉聚焦的那一档之后，插入退回第一档而不是落进别人家', async () => {
    const wrapper = open()
    const box = wrapper.findAll('textarea')[2]
    box?.element.setSelectionRange(0, 0)
    await box?.trigger('select')
    await clickLabelled(wrapper, '删除第 2 档')
    // 父组件受控，这里手动把删完之后的草稿喂回去
    await wrapper.setProps({
      draft: {
        arms: [DRAFT.arms[0] ?? { cond: '', value: '' }],
        otherwise: '0',
        form: 'IFS',
      },
    })
    await wrapper.vm.insert('{x}', 3)
    expect(lastDraft(wrapper)?.arms[0]?.cond).toBe('{x}{a} > 8')
  })

  it('当前选中的文本要透出去：工具箱据此决定套住还是插入', async () => {
    const wrapper = open()
    const box = wrapper.findAll('textarea')[0]
    box?.element.setSelectionRange(0, 3)
    await box?.trigger('select')
    expect(wrapper.vm.selection).toBe('{a}')
  })

  it('一档都没有时插进兜底那一格', async () => {
    const wrapper = open({ arms: [], otherwise: '{a}', form: 'IF' })
    await wrapper.vm.insert(' + {b}', 6)
    expect(lastDraft(wrapper)?.otherwise).toBe(' + {b}{a}')
  })
})
