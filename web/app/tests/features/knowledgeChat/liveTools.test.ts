import { ref } from 'vue'
import { emptyLog } from '@/features/ai/conversationLog'
import type { RunState } from '@/features/ai/conversationSender'
import { createKnowledgeSender } from '@/features/knowledgeChat/sender'
/** @fileoverview 工具校验、元数据最小化和卡片回执恢复。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as collect from '@/api/collect'
import { BizError } from '@/api/client'
import * as search from '@/api/collectSearch'
import {
  livePointOfStep,
  parseLivePoint,
  resolveLivePoint,
  runLiveTool,
  SEARCH_POINTS,
  WATCH_POINT,
} from '@/features/knowledgeChat/liveTools'
import { replayKnowledgeLog } from '@/features/knowledgeChat/liveReplay'
import {
  LIVE_POINT,
  POINT,
  POINT_PAGE,
  SOURCE,
  SOURCE_ID,
} from '@/testing/knowledgeLive'
vi.mock('@/api/collect', () => ({ getSource: vi.fn(), listPoints: vi.fn() }))
vi.mock('@/api/collectSearch', () => ({ searchCollectPoints: vi.fn() }))
beforeEach(() => {
  vi.mocked(collect.getSource).mockResolvedValue(SOURCE)
  vi.mocked(collect.listPoints).mockResolvedValue(POINT_PAGE)
})
afterEach(() => vi.resetAllMocks())

it('opens a real point without forwarding endpoint or credentials', async () => {
  const raw = await runLiveTool({
    call_id: '1',
    name: WATCH_POINT,
    arguments: { node_key: POINT.node_key },
  })
  expect(parseLivePoint(raw)).toEqual(LIVE_POINT)
  expect(raw).not.toContain('private-')
  expect(raw).not.toContain('value')
})
it.each(['', '../../internal', `${SOURCE_ID}:../x`])(
  'rejects invalid point identity %s before HTTP',
  async (key) => {
    await expect(resolveLivePoint(key)).rejects.toThrow('身份')
    expect(collect.getSource).not.toHaveBeenCalled()
  },
)
it('does not confuse a keyword candidate with the exact identity', async () => {
  vi.mocked(collect.listPoints).mockResolvedValue({
    ...POINT_PAGE,
    items: [{ ...POINT, node_key: `${SOURCE_ID}:temp2` }],
  })
  await expect(resolveLivePoint(POINT.node_key)).rejects.toThrow('不存在')
})
it('stops if the source is disabled or permission is denied', async () => {
  vi.mocked(collect.getSource).mockResolvedValue({
    ...SOURCE,
    is_enabled: false,
  })
  await expect(resolveLivePoint(POINT.node_key)).rejects.toThrow('尚未启用')
  vi.mocked(collect.getSource).mockRejectedValue(new Error('无采集权限'))
  await expect(resolveLivePoint(POINT.node_key)).rejects.toThrow('无采集权限')
})
it('aborted tool execution cannot create a card or request data', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    runLiveTool(
      {
        call_id: '1',
        name: WATCH_POINT,
        arguments: { node_key: POINT.node_key },
      },
      controller.signal,
    ),
  ).rejects.toThrow()
  expect(collect.getSource).not.toHaveBeenCalled()
})
it('returns semantic candidates and the explicit degradation note', async () => {
  vi.mocked(search.searchCollectPoints).mockResolvedValue({
    items: [],
    mode: 'keyword',
    pending_count: 2,
    note: '未分配嵌入模型',
  })
  const raw = await runLiveTool({
    call_id: 's',
    name: SEARCH_POINTS,
    arguments: { query: '送风热不热', source_id: SOURCE_ID },
  })
  expect(JSON.parse(raw)).toMatchObject({
    mode: 'keyword',
    pending_count: 2,
    note: '未分配嵌入模型',
  })
  expect(search.searchCollectPoints).toHaveBeenCalledWith(
    '送风热不热',
    SOURCE_ID,
    undefined,
  )
})
it.each([
  { query: '' },
  { query: 'x'.repeat(301) },
  { query: '温度', source_id: '../x' },
])('validates search inputs', async (arguments_) => {
  await expect(
    runLiveTool({ call_id: 's', name: SEARCH_POINTS, arguments: arguments_ }),
  ).rejects.toThrow()
  expect(search.searchCollectPoints).not.toHaveBeenCalled()
})
it.each([
  undefined,
  '{}',
  '[]',
  '{',
  JSON.stringify({ ...LIVE_POINT, unit: 12 }),
  JSON.stringify({ ...LIVE_POINT, node_key: '../x' }),
])('rejects malformed card receipts', (value) => {
  expect(parseLivePoint(value)).toBeNull()
})
it('failed steps do not become cards', () => {
  expect(
    livePointOfStep({
      kind: 'client_tool',
      name: WATCH_POINT,
      state: 'failed',
      title: '',
      error: 'failed',
      output: JSON.stringify(LIVE_POINT),
    }),
  ).toBeNull()
})
describe('history replay', () => {
  it('restores only a receipt matched to an actual watch call', () => {
    const log = replayKnowledgeLog({
      messages: [
        {
          role: 'assistant',
          content_json: {
            text: '',
            tool_calls: [
              {
                id: 'call1',
                name: WATCH_POINT,
                args: { node_key: POINT.node_key },
              },
            ],
          },
          steps: [],
        },
        {
          role: 'tool',
          content_json: {
            tool_call_id: 'call1',
            text: JSON.stringify(LIVE_POINT),
          },
          steps: [],
        },
        { role: 'assistant', content_json: { text: '卡片已打开' }, steps: [] },
      ],
    })
    expect(log.entries[0]?.step?.output).toBe(JSON.stringify(LIVE_POINT))
    expect(log.entries[1]?.text).toBe('卡片已打开')
  })
  it('does not render arbitrary tool output as a live card', () => {
    const log = replayKnowledgeLog({
      messages: [
        {
          role: 'tool',
          content_json: {
            tool_call_id: 'unknown',
            text: JSON.stringify(LIVE_POINT),
          },
          steps: [],
        },
      ],
    })
    expect(log.entries).toEqual([])
  })
})

it('clearing a session discards late tool receipts from the cancelled turn', async () => {
  let release: ((value: typeof SOURCE) => void) | undefined
  let entered: (() => void) | undefined
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.mocked(collect.getSource).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
        entered?.()
      }),
  )
  let log = emptyLog()
  const state: RunState = { running: null }
  const abort = () => {
    state.running?.abort()
    state.running = null
  }
  let round = 0
  const send = createKnowledgeSender({
    sessionId: () => 'session',
    state,
    isRunning: ref(false),
    abort,
    edit: (next) => {
      log = next(log)
    },
    advance: async function* () {
      await Promise.resolve()
      round += 1
      yield round === 1
        ? `event: client_tool.request\ndata: ${JSON.stringify({ calls: [{ call_id: 'w', name: WATCH_POINT, arguments: { node_key: POINT.node_key } }] })}\n\n`
        : 'event: turn.done\ndata: {"reply":"卡片已打开"}\n\n'
    },
  })
  const sending = send('查看温度')
  await started
  abort()
  log = emptyLog()
  release?.(SOURCE)
  await sending
  expect(log.entries).toEqual([])
})

it.each([120, 1212])(
  'rejects a %i-character verbose point description with keyword guidance',
  async (length) => {
    vi.mocked(search.searchCollectPoints).mockResolvedValue({
      items: [],
      mode: 'hybrid',
      pending_count: 0,
      note: null,
    })
    const query = '动力换热2#阀门 实时开度 当前开度百分比位置反馈信号。'
      .repeat(50)
      .slice(0, length)
    await expect(
      runLiveTool({
        call_id: 'search',
        name: SEARCH_POINTS,
        arguments: { query },
      }),
    ).rejects.toThrow('关键词')
    expect(search.searchCollectPoints).not.toHaveBeenCalled()
  },
)

it.each(['动力换热 2#阀门 开度', 'x'.repeat(80)])(
  'preserves concise keywords and identifiers: %s',
  async (query) => {
    vi.mocked(search.searchCollectPoints).mockResolvedValue({
      items: [],
      mode: 'hybrid',
      pending_count: 0,
      note: null,
    })
    await runLiveTool({
      call_id: 'search',
      name: SEARCH_POINTS,
      arguments: { query },
    })
    expect(search.searchCollectPoints).toHaveBeenCalledWith(
      query,
      undefined,
      undefined,
    )
  },
)

it.each([null, ''])(
  'searches all permitted sources when the model has no source id: %s',
  async (sourceId) => {
    vi.mocked(search.searchCollectPoints).mockResolvedValue({
      items: [],
      mode: 'hybrid',
      pending_count: 0,
      note: null,
    })
    await runLiveTool({
      call_id: 'search',
      name: SEARCH_POINTS,
      arguments: { query: '余热回收 水箱 温度', source_id: sourceId },
    })
    expect(search.searchCollectPoints).toHaveBeenCalledWith(
      '余热回收 水箱 温度',
      undefined,
      undefined,
    )
  },
)

it('rejects the invented nil UUID instead of reporting no matching points', async () => {
  vi.mocked(search.searchCollectPoints).mockResolvedValue({
    items: [],
    mode: 'hybrid',
    pending_count: 0,
    note: null,
  })
  await expect(
    runLiveTool({
      call_id: 'search',
      name: SEARCH_POINTS,
      arguments: {
        query: '余热回收 水箱 温度',
        source_id: '00000000-0000-0000-0000-000000000000',
      },
    }),
  ).rejects.toThrow('null')
  expect(search.searchCollectPoints).not.toHaveBeenCalled()
})

it('rejects a nonexistent source without returning a misleading empty match list', async () => {
  vi.mocked(collect.getSource).mockRejectedValue(
    new BizError(41101, '数据源不存在', 404, 'test'),
  )
  await expect(
    runLiveTool({
      call_id: 's',
      name: SEARCH_POINTS,
      arguments: { query: '余热回收 水箱 温度', source_id: SOURCE_ID },
    }),
  ).rejects.toThrow('省略source_id')
  expect(search.searchCollectPoints).not.toHaveBeenCalled()
})

it('does not broaden a forbidden source to all sources', async () => {
  vi.mocked(collect.getSource).mockRejectedValue(
    new BizError(40301, '无采集权限', 403, 'test'),
  )
  await expect(
    runLiveTool({
      call_id: 's',
      name: SEARCH_POINTS,
      arguments: { query: '余热回收 水箱 温度', source_id: SOURCE_ID },
    }),
  ).rejects.toThrow('无采集权限')
  expect(search.searchCollectPoints).not.toHaveBeenCalled()
})
