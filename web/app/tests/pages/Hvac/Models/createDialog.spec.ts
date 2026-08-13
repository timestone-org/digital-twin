/**
 * @fileoverview 新建模型对话框：覆盖度驱动的组合勾选、提交载荷、竞态防护。
 *
 * ⚠ 换房间会触发覆盖度取数：慢的那次后返回不许把勾选项刷成上一个房间的组合。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { Room, StartupBatches } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import CreateModelDialog from '@/pages/Hvac/Models/components/CreateModelDialog.vue'
import { STAMP, model } from '@/testing/modelFixtures'

function room(id: string, name: string): Room {
  return {
    id,
    name,
    workshop: { id: 'w1', name: '东车间' },
    ac_unit_count: 2,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function batches(over: Partial<StartupBatches> = {}): StartupBatches {
  return {
    items: [],
    current: {
      id: 'b1',
      status: 'ready',
      is_current: true,
      params_fingerprint: 'abc',
      logic_version: 2,
      window_start: STAMP,
      window_end: STAMP,
      shard_total: 1,
      shard_done: 1,
      episode_count: 10,
      unmatched_exclusion_count: 0,
      created_at: STAMP,
      updated_at: STAMP,
    },
    coverage: [
      { running_set: ['K12', 'K11'], usable_count: 110 },
      { running_set: ['K11'], usable_count: 12 },
    ],
    expected_fingerprint: 'abc',
    is_stale: false,
    source_range: null,
    ...over,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.spyOn(hvac, 'getStartupBatches').mockResolvedValue(batches())
  vi.spyOn(hvac, 'createAcModel').mockResolvedValue(model())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open() {
  const wrapper = mount(CreateModelDialog, {
    attachTo: document.body,
    props: { open: true, rooms: [room('r1', '注塑房'), room('r2', '仓库')] },
  })
  await flushPromises()
  return wrapper
}

/** 弹层 Teleport 到 body：查询一律走 document，wrapper 只拿事件。 */
function bodyText(): string {
  return document.body.textContent ?? ''
}

function findButton(label: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  )
}

/** DtSelect 是自绘下拉：点开触发器再点选项。 */
async function pickRoom(label: string): Promise<void> {
  const trigger = document.body.querySelector<HTMLButtonElement>(
    'button[aria-haspopup="listbox"]',
  )
  trigger?.click()
  await flushPromises()
  const option = [...document.body.querySelectorAll('[role="option"]')].find(
    (item) => item.textContent?.includes(label),
  )
  ;(option as HTMLElement | undefined)?.click()
  await flushPromises()
}

describe('组合勾选', () => {
  it('选了房间才列组合，标着各自的可用事件数', async () => {
    await open()
    expect(bodyText()).toContain('先选房间')
    await pickRoom('注塑房')
    expect(bodyText()).toContain('K11+K12（可用 110 条）')
    expect(bodyText()).toContain('K11（可用 12 条）')
  })

  it('房间没抽取过时说清先去重算，而不是给一个空列表', async () => {
    vi.mocked(hvac.getStartupBatches).mockResolvedValue(
      batches({ current: null, coverage: [] }),
    )
    await open()
    await pickRoom('注塑房')
    expect(bodyText()).toContain('先去开机事件页重算')
  })

  it('提交载荷：勾选的组合按 serial 升序，名称去掉首尾空白', async () => {
    const wrapper = await open()
    await pickRoom('注塑房')
    const checkbox = document.body.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )
    checkbox?.click()
    await flushPromises()
    const name = [...document.body.querySelectorAll('input')].find(
      (item) => item.type === 'text',
    )
    if (name) {
      name.value = '  早班模型  '
      name.dispatchEvent(new Event('input'))
    }
    await flushPromises()
    findButton('建模并训练')?.click()
    await flushPromises()
    expect(hvac.createAcModel).toHaveBeenCalledWith({
      room_id: 'r1',
      name: '早班模型',
      serving_sets: [['K11', 'K12']],
      half_life_days: 180,
    })
    expect(wrapper.emitted('created')).toEqual([['m1']])
  })

  it('⚠ 换房间的竞态：慢的那次后返回不许把组合刷成上一个房间的', async () => {
    let releaseFirst: (value: StartupBatches) => void = () => undefined
    vi.mocked(hvac.getStartupBatches)
      .mockImplementationOnce(
        () =>
          new Promise<StartupBatches>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce(
        batches({
          coverage: [{ running_set: ['K21'], usable_count: 5 }],
        }),
      )
    await open()
    await pickRoom('注塑房')
    await pickRoom('仓库')
    // 第一个房间的响应这时才回来——必须被丢弃
    releaseFirst(batches())
    await flushPromises()
    expect(bodyText()).toContain('K21')
    expect(bodyText()).not.toContain('K11+K12')
  })
})
