/**
 * @fileoverview 实时测试弹窗的十三种状态：打开即出结果，以及每一条
 * 「读不到 / 缺数 / 陈旧 / 改过 / 工件不认识」都必须说出来。
 *
 * ⚠ 503 时绝不能出现任何读数值——「不拿旧数据顶上」是这个弹窗的底线。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { AcModel, ModelRecommendResult } from '@dt/contracts'

import { BizError } from '@/api/client'
import * as hvac from '@/api/hvac'
import LiveTestDialog from '@/pages/Hvac/ModelDetail/components/LiveTestDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { STAMP, liveReadings, liveUnit, model } from '@/testing/modelFixtures'

const BLANK = {
  workshop_temp_avg: null,
  workshop_humidity_avg: null,
  fresh_air_temp: null,
  fresh_air_humidity: null,
  chilled_water_supply_temp: null,
}

function recommendResult(
  over: Partial<ModelRecommendResult> = {},
): ModelRecommendResult {
  return {
    items: [
      {
        running_set: ['K11'],
        set_key: 'K11',
        p10: 6.1,
        p50: 12.4,
        p90: 24.8,
        interval_width_minutes: 18.7,
        instant_probability: 0.18,
        reliability: 'reliable',
        is_dedicated: true,
        is_recommended: true,
      },
    ],
    trained_at: STAMP,
    ...over,
  }
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  signIn(['ac:view', 'ac:manage'])
  document.body.innerHTML = ''
  vi.spyOn(hvac, 'getRoomLiveReadings').mockResolvedValue(liveReadings())
  vi.spyOn(hvac, 'recommendWithAcModel').mockResolvedValue(recommendResult())
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function open(over: Partial<AcModel> = {}) {
  const wrapper = mount(LiveTestDialog, {
    props: { open: false, model: model(over) },
    attachTo: document.body,
  })
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

// ⚠ DtModal 走 Teleport：内容挂在 body 上，wrapper.find 一律扫不到
function bodyText(): string {
  return document.body.textContent ?? ''
}

async function click(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(label),
  )
  button?.click()
  await flushPromises()
}

/** DtNumberInput 是 role=spinbutton 的文本框，落定在 change 上不在 input 上。 */
function numberFields(): HTMLInputElement[] {
  return [
    ...document.body.querySelectorAll<HTMLInputElement>(
      'input[role="spinbutton"]',
    ),
  ]
}

async function typeNumber(at: number, value: string): Promise<void> {
  const field = numberFields()[at]
  if (field === undefined) throw new Error(`第 ${at} 个数字输入框不存在`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
}

async function toggleTuning(on: boolean): Promise<void> {
  const box = document.body.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  )
  if (box === null) throw new Error('找不到微调开关')
  box.checked = on
  box.dispatchEvent(new Event('change', { bubbles: true }))
  await flushPromises()
}

describe('打开即出结果', () => {
  it('取数与推荐各发一次，结果卡直接摆出来', async () => {
    await open()
    expect(hvac.getRoomLiveReadings).toHaveBeenCalledWith('r1')
    expect(hvac.recommendWithAcModel).toHaveBeenCalledWith('m1', {
      readings: {
        K11: {
          workshop_temp_avg: 24.1,
          workshop_humidity_avg: 58,
          fresh_air_temp: 31.2,
          fresh_air_humidity: 71,
          chilled_water_supply_temp: 8.4,
        },
      },
    })
    expect(bodyText()).toContain('12.4 分钟')
    expect(bodyText()).toContain('推荐')
  })

  it('逐台读数与取数时刻摆在下面供核对', async () => {
    await open()
    expect(bodyText()).toContain('回看 15 分钟')
    expect(bodyText()).toContain('24.1')
    expect(bodyText()).toContain('运行')
  })

  it('未出数的组合列在结果下方，说清为什么', async () => {
    await open()
    expect(bodyText()).toContain('有 1 个服务组合没有出数：K11+K12')
  })

  it('footer 那颗重新取数并推荐会再走一遍两条请求', async () => {
    await open()
    await click('重新取数并推荐')
    expect(hvac.getRoomLiveReadings).toHaveBeenCalledTimes(2)
    expect(hvac.recommendWithAcModel).toHaveBeenCalledTimes(2)
  })
})

describe('取数出问题', () => {
  it('⚠ E1 数据源不可达：明说不拿旧数据顶上，且屏幕上不出现任何读数值', async () => {
    vi.mocked(hvac.getRoomLiveReadings).mockRejectedValue(
      new BizError(51601, '外部数据源不可用', 503, 't'),
    )
    await open()
    expect(bodyText()).toContain('这里不会拿旧数据顶上')
    expect(bodyText()).not.toContain('24.1')
    expect(hvac.recommendWithAcModel).not.toHaveBeenCalled()
  })

  it('E1 下仍可按未知条件试算，且结果标明不含当前温湿度', async () => {
    vi.mocked(hvac.getRoomLiveReadings).mockRejectedValue(
      new BizError(51601, '外部数据源不可用', 503, 't'),
    )
    await open()
    await click('仍要按未知条件试算')
    expect(hvac.recommendWithAcModel).toHaveBeenCalledWith('m1', {
      readings: {},
    })
    expect(bodyText()).toContain('不含当前温湿度')
  })

  it('E2 房间没绑机组：终止，footer 只剩关闭', async () => {
    vi.mocked(hvac.getRoomLiveReadings).mockResolvedValue(liveReadings([]))
    await open()
    expect(bodyText()).toContain('还没有绑定空调机组')
    expect(bodyText()).not.toContain('重新取数并推荐')
    expect(hvac.recommendWithAcModel).not.toHaveBeenCalled()
  })

  it('E3 其它错误：说原因并可重试', async () => {
    vi.mocked(hvac.getRoomLiveReadings).mockRejectedValue(new Error('boom'))
    await open()
    expect(bodyText()).toContain('请求失败')
    await click('重试')
    expect(hvac.getRoomLiveReadings).toHaveBeenCalledTimes(2)
  })
})

describe('读数有问题', () => {
  it('⚠ W1 窗内全无数据：不自动推荐，交给用户决定', async () => {
    vi.mocked(hvac.getRoomLiveReadings).mockResolvedValue(
      liveReadings([
        liveUnit({ sampled_at: null, is_running: null, readings: BLANK }),
      ]),
    )
    await open()
    expect(bodyText()).toContain('没有任何读数')
    expect(hvac.recommendWithAcModel).not.toHaveBeenCalled()
    await click('仍要按未知条件试算')
    expect(hvac.recommendWithAcModel).toHaveBeenCalledWith('m1', {
      readings: {},
    })
  })

  it('W2 部分缺数：照常推荐，缺的那台标「无数据」', async () => {
    vi.mocked(hvac.getRoomLiveReadings).mockResolvedValue(
      liveReadings([
        liveUnit(),
        liveUnit({
          serial: 'K12',
          sampled_at: null,
          is_running: null,
          readings: BLANK,
        }),
      ]),
    )
    await open()
    expect(bodyText()).toContain('1 台机组窗内没有读数')
    expect(bodyText()).toContain('无数据')
    expect(hvac.recommendWithAcModel).toHaveBeenCalled()
    // ⚠ 那台整台不进 readings 字典
    const call = vi.mocked(hvac.recommendWithAcModel).mock.calls[0]
    expect(Object.keys(call?.[1].readings ?? {})).toEqual(['K11'])
  })

  it('⚠ W3 读数陈旧：说清几台多旧，采样列标警示色', async () => {
    vi.mocked(hvac.getRoomLiveReadings).mockResolvedValue(
      liveReadings([liveUnit({ sampled_at: '2026-08-12T02:40:00.000Z' })]),
    )
    await open()
    expect(bodyText()).toContain('有 1 台的最新读数已经是 20 分钟前的了')
    expect(document.body.querySelector('.text-state-warning')).not.toBeNull()
  })

  it('⚠ is_running 为 null 渲染「未知」而不是「停机」', async () => {
    vi.mocked(hvac.getRoomLiveReadings).mockResolvedValue(
      liveReadings([liveUnit({ is_running: null })]),
    )
    await open()
    expect(bodyText()).toContain('未知')
    expect(bodyText()).not.toContain('停机')
  })
})

describe('推荐出问题', () => {
  it('⚠ E4 工件不认识这些机组：指路重训，并包权限门', async () => {
    vi.mocked(hvac.recommendWithAcModel).mockRejectedValue(
      new BizError(41620, '机组都不在训练时的清单里', 422, 't'),
    )
    const wrapper = await open()
    expect(bodyText()).toContain('模型工件里没有这些机组')
    await click('去重训')
    expect(wrapper.emitted('retrain')).toHaveLength(1)
  })

  it('E4 的「去重训」对只读账号不渲染', async () => {
    setActivePinia(createPinia())
    signIn(['ac:view'])
    vi.mocked(hvac.recommendWithAcModel).mockRejectedValue(
      new BizError(41620, '机组都不在训练时的清单里', 422, 't'),
    )
    await open()
    expect(bodyText()).toContain('模型工件里没有这些机组')
    expect(bodyText()).not.toContain('去重训')
  })

  it('E5 其它错误：只重试推荐，不重新取数', async () => {
    vi.mocked(hvac.recommendWithAcModel).mockRejectedValue(new Error('boom'))
    await open()
    expect(bodyText()).toContain('请求失败')
    await click('重试推荐')
    expect(hvac.recommendWithAcModel).toHaveBeenCalledTimes(2)
    expect(hvac.getRoomLiveReadings).toHaveBeenCalledTimes(1)
  })
})

describe('模型自身的状态', () => {
  it('M1 正在重训：说清用的是上一次的工件', async () => {
    await open({ status: 'training' })
    expect(bodyText()).toContain('这次用的是上一次训练的工件')
  })

  it('M2 上次重训失败：说清用的是更早那一次', async () => {
    await open({ status: 'failed', error: '炸了' })
    expect(bodyText()).toContain('更早那一次成功训练的工件')
  })
})

describe('微调与重算', () => {
  it('微调默认收起；不改动时「按调整后条件重算」点不动', async () => {
    await open()
    // 只有「全停时长」那一个，五项读数还是纯文本
    expect(numberFields()).toHaveLength(1)
    const recompute = [...document.body.querySelectorAll('button')].find(
      (node) => node.textContent?.includes('按调整后条件重算'),
    )
    expect(recompute?.disabled).toBe(true)
  })

  it('勾上微调后五项读数换成输入框，五项都能改', async () => {
    await open()
    await toggleTuning(true)
    expect(numberFields()).toHaveLength(6)
    await typeNumber(1, '61')
    await typeNumber(2, '33')
    await typeNumber(3, '70')
    await typeNumber(4, '9')
    await click('按调整后条件重算')
    expect(hvac.recommendWithAcModel).toHaveBeenLastCalledWith('m1', {
      readings: {
        K11: {
          workshop_temp_avg: 24.1,
          workshop_humidity_avg: 61,
          fresh_air_temp: 33,
          fresh_air_humidity: 70,
          chilled_water_supply_temp: 9,
        },
      },
    })
  })

  it('⚠ 清空一格 = 缺测：那个字段整个不发，不发 null 也不填 0', async () => {
    await open()
    await toggleTuning(true)
    await typeNumber(0, '')
    await click('按调整后条件重算')
    const last = vi.mocked(hvac.recommendWithAcModel).mock.calls.at(-1)
    expect(last?.[1].readings?.['K11']).not.toHaveProperty('workshop_temp_avg')
    expect(last?.[1].readings?.['K11']).toHaveProperty('fresh_air_temp')
  })

  it('⚠ 改过读数后两处都要标：顶部提示与结果区标签', async () => {
    await open()
    await toggleTuning(true)
    await typeNumber(0, '26.5')
    await click('按调整后条件重算')
    expect(hvac.recommendWithAcModel).toHaveBeenLastCalledWith('m1', {
      readings: {
        K11: {
          workshop_temp_avg: 26.5,
          workshop_humidity_avg: 58,
          fresh_air_temp: 31.2,
          fresh_air_humidity: 71,
          chilled_water_supply_temp: 8.4,
        },
      },
    })
    expect(bodyText()).toContain('已手动调整')
    expect(bodyText()).toContain('不是当前实时工况')
  })

  it('取消勾选丢弃全部改动，恢复实时值', async () => {
    await open()
    await toggleTuning(true)
    await typeNumber(0, '26.5')
    await toggleTuning(false)
    expect(bodyText()).toContain('24.1')
    expect(bodyText()).not.toContain('26.5')
  })

  it('全停时长改过也能重算，且真的发出去', async () => {
    await open()
    await typeNumber(0, '40')
    await click('按调整后条件重算')
    expect(hvac.recommendWithAcModel).toHaveBeenLastCalledWith(
      'm1',
      expect.objectContaining({ idle_minutes: 40 }),
    )
  })
})

describe('相对时间的定时器', () => {
  it('⚠ 关弹窗要把 30 秒 tick 停掉，否则它会一直转', async () => {
    vi.useFakeTimers()
    const wrapper = mount(LiveTestDialog, {
      props: { open: false, model: model() },
      attachTo: document.body,
    })
    await wrapper.setProps({ open: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    await wrapper.setProps({ open: false })
    // ⚠ Vue 首次建渲染器时 devtools 钩子会排一只一次性 3s timer：本测试若是
    // 本文件第一个跑（乱序），它就落在假时钟里。推 3s 吃掉它——泄漏的 30s
    // interval 是自续的，推完仍会被数出来，断言力度不变。
    await vi.advanceTimersByTimeAsync(3_000)
    expect(vi.getTimerCount()).toBe(0)
  })
})
