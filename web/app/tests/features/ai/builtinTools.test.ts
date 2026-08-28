/**
 * @fileoverview 内建客户端工具：不归任何工作面，每一页都能用。
 *
 * 守的是这一条最容易写漏的规矩——把 `user.ask` 塞进各工作面的 `tools` 数组
 * 也能让大屏编辑器问上话，于是「一个工作面都没登记的页面里助手闷头就改」
 * 这件事要等到现场才发现。这里对着「没有工作面」那一档钉死。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ASSISTANT_ASK_TOOL, type AssistantAskAnswer } from '@dt/contracts'

import { __resetAskHandler, setAskHandler } from '@/features/ai/askBridge'
import {
  askRequestOf,
  BUILTIN_CLIENT_TOOLS,
  isBuiltinTool,
  runBuiltinTool,
} from '@/features/ai/builtinTools'
import { __resetSurfaces } from '@/features/ai/surfaces'

const PICKED: AssistantAskAnswer = {
  picked: ['yes'],
  free_text: null,
  is_cancelled: false,
}

function call(args: Record<string, unknown>): {
  call_id: string
  name: string
  arguments: Record<string, unknown>
} {
  return { call_id: 'c1', name: ASSISTANT_ASK_TOOL, arguments: args }
}

const ASKING = {
  question: '要覆盖这 12 条绑定吗？',
  options: [
    { value: 'yes', label: '覆盖' },
    { value: 'no', label: '留着' },
  ],
}

afterEach(() => {
  __resetAskHandler()
  __resetSurfaces()
})

describe('内建工具表', () => {
  it('提问在表里', () => {
    expect([...BUILTIN_CLIENT_TOOLS]).toContain(ASSISTANT_ASK_TOOL)
    expect(isBuiltinTool(ASSISTANT_ASK_TOOL)).toBe(true)
  })

  it('别的名字不归它管', () => {
    expect(isBuiltinTool('dashboard.write_binding')).toBe(false)
  })

  it('一个工作面都没登记时照样跑得起来', async () => {
    setAskHandler(() => Promise.resolve(PICKED))
    // 没有 setSurface：`runClientTool` 在这一档会抛 UnsupportedTool
    await expect(runBuiltinTool(call(ASKING))).resolves.toEqual(PICKED)
  })

  it('不认识的名字照样抛，不静默成功', async () => {
    await expect(
      runBuiltinTool({ call_id: 'c1', name: 'nope', arguments: {} }),
    ).rejects.toThrow(/nope/)
  })
})

describe('入参窄化', () => {
  it('两个开关缺省是关的，提示语没给就是 null', () => {
    expect(askRequestOf(ASKING)).toEqual({
      question: '要覆盖这 12 条绑定吗？',
      options: [
        { value: 'yes', label: '覆盖' },
        { value: 'no', label: '留着' },
      ],
      allow_multiple: false,
      allow_free_text: false,
      free_text_label: null,
    })
  })

  it('补充说明跟着那一项带过来', () => {
    const parsed = askRequestOf({
      ...ASKING,
      options: [{ value: 'yes', label: '覆盖', hint: '温度槽会被换掉' }],
    })
    expect(parsed.options[0]?.hint).toBe('温度槽会被换掉')
  })

  it('残缺的选项丢掉，不留一颗空白按钮', () => {
    const parsed = askRequestOf({
      ...ASKING,
      options: [{ value: 'yes', label: '覆盖' }, { value: 'no' }, 'nope', null],
    })
    expect(parsed.options).toHaveLength(1)
  })

  it('一个选项都没有时抛：那就是自由提问，正是要换掉的行为', () => {
    expect(() =>
      askRequestOf({ question: '你想怎么办？', options: [] }),
    ).toThrow(/选项/)
    expect(() => askRequestOf({ question: '你想怎么办？' })).toThrow(/选项/)
  })

  it('没有问题也抛', () => {
    expect(() => askRequestOf({ options: ASKING.options })).toThrow(/问题/)
  })
})

describe('提问桥', () => {
  it('没人接时回一条取消，不抛', async () => {
    // 抛出去模型收到的是「工具坏了」，它会去排查一个不存在的故障
    const answer = await runBuiltinTool(call(ASKING))
    expect(answer).toEqual({
      picked: [],
      free_text: null,
      is_cancelled: true,
    })
  })

  it('问题原样交给处理器', async () => {
    const handler = vi.fn(() => Promise.resolve(PICKED))
    setAskHandler(handler)
    await runBuiltinTool(
      call({ ...ASKING, allow_multiple: true, free_text_label: '写个名字' }),
    )
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        question: '要覆盖这 12 条绑定吗？',
        allow_multiple: true,
        free_text_label: '写个名字',
      }),
    )
  })
})

describe('没有哪个工作面自己登记内建工具', () => {
  /** 各页面的工作面定义，按源码原文读。 */
  const SURFACES = import.meta.glob<string>(
    '../../../src/pages/**/aiSurface.ts',
    { query: '?raw', import: 'default', eager: true },
  )

  it('确实扫到了那几份工作面（扫不到就等于这条闸没跑）', () => {
    expect(Object.keys(SURFACES).length).toBeGreaterThan(0)
  })

  it.each(Object.keys(SURFACES))('%s 的 tools 里没有内建工具', (path) => {
    // ⚠ 塞进去的话，一个工作面都没登记的页面就用不上它，而且每新增一页都要
    // 有人记得加一行——漏了的表现是「助手在那一页从不问，闷头就改」
    for (const builtin of BUILTIN_CLIENT_TOOLS) {
      expect(SURFACES[path] ?? '').not.toContain(builtin)
    }
  })
})
