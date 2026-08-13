/**
 * @fileoverview 模型详情页：评估与逐条对比的呈现、训练中的口径、试算。
 *
 * ⚠ 训练中必须继续显示上一次的评估（半份/空数据比旧数据危险），
 * 到终态那一刻逐条对比要跟着刷新——训练把它整体换掉了。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import DetailPage from '@/pages/Hvac/ModelDetail/index.vue'
import { useAuthStore } from '@/stores/auth'
import {
  STAMP,
  model,
  prediction,
  predictionPage,
} from '@/testing/modelFixtures'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({
    path: '/hvac/models/m1',
    params: { modelId: 'm1' },
    query: {},
  }),
  RouterLink: { template: '<a><slot /></a>' },
}))

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
  useToast().clear()
  vi.spyOn(hvac, 'getAcModel').mockResolvedValue(model())
  vi.spyOn(hvac, 'listModelPredictions').mockResolvedValue(
    predictionPage([
      prediction(),
      prediction({
        started_at: '2026-08-11T02:00:00.000Z',
        actual_minutes: 60,
        p10: 20,
        p50: 30,
        p90: 40,
      }),
    ]),
  )
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function open() {
  const wrapper = mount(DetailPage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('评估呈现', () => {
  it('总体卡片给出 MAE、覆盖率与样本数', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('4.2 分钟')
    expect(wrapper.text()).toContain('82%')
    expect(wrapper.text()).toContain('120')
  })

  it('⚠ 没样本的组合标「无样本」，不显示成零误差', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('无样本')
    expect(wrapper.text()).toContain('K11+K12')
  })

  it('逐条对比里区间没盖住实际值的行标出来', async () => {
    const wrapper = await open()
    // 第二条：实际 60 在 [20,40] 之外
    expect(wrapper.find('.text-state-warning').exists()).toBe(true)
  })

  it('失败的模型把人话原因亮出来，同时保留上一次的评估', async () => {
    vi.mocked(hvac.getAcModel).mockResolvedValue(
      model({ status: 'failed', error: '训练超过 600 秒被掐断' }),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('训练超过 600 秒被掐断')
    expect(wrapper.text()).toContain('4.2 分钟')
  })
})

describe('训练中', () => {
  it('轮询到终态即停，并刷新逐条对比', async () => {
    vi.useFakeTimers()
    vi.mocked(hvac.getAcModel)
      .mockResolvedValueOnce(model({ status: 'training' }))
      .mockResolvedValue(model())
    mount(DetailPage, { attachTo: document.body })
    await vi.advanceTimersByTimeAsync(0)
    expect(hvac.getAcModel).toHaveBeenCalledTimes(1)
    expect(hvac.listModelPredictions).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(hvac.getAcModel).toHaveBeenCalledTimes(2)
    // 到终态：逐条对比已被训练整体换掉，跟着刷新一次
    expect(hvac.listModelPredictions).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(15000)
    expect(hvac.getAcModel).toHaveBeenCalledTimes(2)
  })
})

describe('试算', () => {
  it('按选中组合提交并展示三分位与可靠性', async () => {
    vi.spyOn(hvac, 'predictWithAcModel').mockResolvedValue({
      p10: 18,
      p50: 25.4,
      p90: 39,
      interval_width_minutes: 21,
      reliability: 'reliable',
      is_in_serving_sets: true,
      trained_at: STAMP,
    })
    const wrapper = await open()
    const run = wrapper.findAll('button').find((item) => item.text() === '试算')
    await run?.trigger('click')
    await flushPromises()
    expect(hvac.predictWithAcModel).toHaveBeenCalledWith('m1', {
      running_set: ['K11'],
      readings: {},
    })
    expect(wrapper.text()).toContain('25.4 分钟')
    expect(wrapper.text()).toContain('可靠')
  })

  it('服务组合之外的外推要标出来', async () => {
    vi.spyOn(hvac, 'predictWithAcModel').mockResolvedValue({
      p10: 10,
      p50: 45,
      p90: 90,
      interval_width_minutes: 80,
      reliability: 'weak',
      is_in_serving_sets: false,
      trained_at: STAMP,
    })
    const wrapper = await open()
    const run = wrapper.findAll('button').find((item) => item.text() === '试算')
    await run?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('服务组合之外的外推')
    expect(wrapper.text()).toContain('仅供参考')
  })
})
