/**
 * @fileoverview 模型详情页：评估与逐条对比的呈现、训练中的口径、试算。
 *
 * ⚠ 训练中必须继续显示上一次的评估（半份/空数据比旧数据危险），
 * 到终态那一刻逐条对比要跟着刷新——训练把它整体换掉了。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { DtConfirmHost, DtToastHost, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import DetailPage from '@/pages/Hvac/ModelDetail/index.vue'
import { useAuthStore } from '@/stores/auth'
import {
  STAMP,
  model,
  prediction,
  predictionPage,
} from '@/testing/modelFixtures'

const pushMock = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: pushMock }),
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
  pushMock.mockClear()
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
      // 零行（开机即达标且判对）：散点上要淡化显示
      prediction({
        started_at: '2026-08-10T02:00:00.000Z',
        actual_minutes: 0,
        p10: 0,
        p50: 0,
        p90: 0,
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

/** 确认框 Teleport 到 body：在弹层范围内点确认钮，避开行里的同名按钮。 */
async function clickConfirm(): Promise<void> {
  const dialog = document.querySelector('[role="dialog"]') ?? document.body
  const buttons = [...dialog.querySelectorAll('button')]
  const accept = buttons.find((node) => node.textContent?.includes('删除'))
  accept?.click()
  await flushPromises()
}

describe('评估呈现', () => {
  it('⚠ 评估卡的主口径是热行：MAE/覆盖率取 hot，样本按热/零拆开', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('4.2 分钟')
    expect(wrapper.text()).toContain('82%')
    expect(wrapper.text()).toContain('热 80 / 零 40')
    // 判零 / 判出
    expect(wrapper.text()).toContain('97%')
    expect(wrapper.text()).toContain('95%')
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

  it('⚠ 散点上零行淡化：它们堆在原点，不许压住热行的真实表现', async () => {
    const wrapper = await open()
    const paints = wrapper
      .findAll('circle')
      .map((node) => node.attributes('class'))
    expect(paints).toContain('fill-text-disabled/40')
    expect(paints).toContain('fill-state-warning')
    expect(paints).toContain('fill-accent-primary/70')
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

describe('操作', () => {
  it('重训入队后提示并刷新详情', async () => {
    vi.spyOn(hvac, 'retrainAcModel').mockResolvedValue(
      model({ status: 'queued' }),
    )
    const wrapper = await open()
    const retrain = wrapper
      .findAll('button')
      .find((item) => item.text() === '重训')
    await retrain?.trigger('click')
    await flushPromises()
    expect(hvac.retrainAcModel).toHaveBeenCalledWith('m1')
    expect(hvac.getAcModel).toHaveBeenCalledTimes(2)
  })

  it('删除过确认后跳回列表', async () => {
    vi.spyOn(hvac, 'deleteAcModel').mockResolvedValue(undefined)
    const wrapper = mount(
      {
        components: { DetailPage, DtConfirmHost, DtToastHost },
        template: '<DetailPage /><DtConfirmHost /><DtToastHost />',
      },
      { attachTo: document.body },
    )
    await flushPromises()
    const remove = wrapper
      .findAll('button')
      .find((item) => item.text() === '删除')
    await remove?.trigger('click')
    await flushPromises()
    await clickConfirm()
    expect(hvac.deleteAcModel).toHaveBeenCalledWith('m1')
    expect(pushMock).toHaveBeenCalledWith('/hvac/models')
  })

  it('取模型失败时把原因亮出来', async () => {
    vi.mocked(hvac.getAcModel).mockRejectedValue(new Error('boom'))
    const wrapper = await open()
    expect(wrapper.text()).toContain('请求失败')
  })

  it('特征口径过期时提示重训', async () => {
    vi.mocked(hvac.getAcModel).mockResolvedValue(
      model({ is_feature_stale: true }),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('特征口径已更新')
  })
})

describe('开机策略推荐', () => {
  it('一次给全部服务组合出预测，第一名带推荐标', async () => {
    vi.spyOn(hvac, 'recommendWithAcModel').mockResolvedValue({
      items: [
        {
          running_set: ['K11'],
          set_key: 'K11',
          p10: 18,
          p50: 25.4,
          p90: 39,
          interval_width_minutes: 21,
          instant_probability: 0.35,
          reliability: 'reliable',
          is_dedicated: true,
          is_recommended: true,
        },
        {
          running_set: ['K11', 'K12'],
          set_key: 'K11+K12',
          p10: 10,
          p50: 45,
          p90: 90,
          interval_width_minutes: 80,
          instant_probability: 0.1,
          reliability: 'weak',
          is_dedicated: false,
          is_recommended: false,
        },
      ],
      trained_at: STAMP,
    })
    const wrapper = await open()
    const run = wrapper
      .findAll('button')
      .find((item) => item.text() === '推荐开机策略')
    await run?.trigger('click')
    await flushPromises()
    expect(hvac.recommendWithAcModel).toHaveBeenCalledWith('m1', {
      readings: {},
    })
    expect(wrapper.text()).toContain('25.4 分钟')
    expect(wrapper.text()).toContain('推荐')
    expect(wrapper.text()).toContain('开机即达标 35%')
    expect(wrapper.text()).toContain('组合专属模型')
    expect(wrapper.text()).toContain('共用模型兜底')
    expect(wrapper.text()).toContain('仅供参考')
  })

  it('推荐失败把原因亮出来，不静默', async () => {
    vi.spyOn(hvac, 'recommendWithAcModel').mockRejectedValue(new Error('boom'))
    const wrapper = await open()
    const run = wrapper
      .findAll('button')
      .find((item) => item.text() === '推荐开机策略')
    await run?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('请求失败')
  })
})

describe('逐条对比', () => {
  it('⚠ 换组合过滤要回第一页重取，组合键转成逗号分隔', async () => {
    await open()
    expect(hvac.listModelPredictions).toHaveBeenCalledWith('m1', {
      page: 1,
      size: 20,
    })
    const trigger = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="按组合过滤"]',
    )
    trigger?.click()
    await flushPromises()
    const option = [...document.body.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent?.includes('K11+K12'),
    )
    ;(option as HTMLElement | undefined)?.click()
    await flushPromises()
    expect(hvac.listModelPredictions).toHaveBeenLastCalledWith('m1', {
      page: 1,
      size: 20,
      running_set: 'K11,K12',
    })
  })
})
