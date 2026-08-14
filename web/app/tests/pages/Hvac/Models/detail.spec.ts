/**
 * @fileoverview 模型详情页：评估口径、折外总览、按组合过滤联动、逐条对比。
 *
 * ⚠ 训练中必须继续显示上一次的评估（半份/空数据比旧数据危险），
 * 到终态那一刻折外预测（全量与分页两处）要跟着刷新——训练把它整体换掉了。
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
  liveReadings,
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
  vi.spyOn(hvac, 'getRoomLiveReadings').mockResolvedValue(liveReadings())
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

  it('⚠ 整体口径只出现一次且带「含零行，仅供对照」', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('含零行，仅供对照')
    expect(wrapper.text()).toContain('0.81')
    expect(wrapper.text()).toContain('0.64')
  })

  it('出处条把窗口、样本、半衰期与特征版本收进一行', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('数据窗口')
    expect(wrapper.text()).toContain('半衰期 180 天')
    expect(wrapper.text()).toContain('特征 v1')
    expect(wrapper.text()).toContain('训练于')
  })

  it('⚠ 出处条缺什么写破折号，从没训过就写「尚未训练」，不编数', async () => {
    vi.mocked(hvac.getAcModel).mockResolvedValue(
      model({
        window_start: null,
        window_end: null,
        sample_count: null,
        feature_version: null,
        trained_at: null,
      }),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('数据窗口 —')
    expect(wrapper.text()).toContain('样本 —')
    expect(wrapper.text()).toContain('尚未训练')
  })

  it('⚠ R² 为负数照实显示并标危险色；覆盖率跌破 0.7 标警示', async () => {
    const base = model()
    if (base.metrics === null) throw new Error('夹具里应有评估')
    const hot = base.metrics.overall.hot
    if (hot === null) throw new Error('夹具里应有热行')
    vi.mocked(hvac.getAcModel).mockResolvedValue(
      model({
        metrics: {
          ...base.metrics,
          overall: {
            ...base.metrics.overall,
            hot: { ...hot, r2: -0.14, coverage: 0.5 },
          },
        },
      }),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('-0.14')
    expect(wrapper.find('.text-state-danger').exists()).toBe(true)
    expect(wrapper.text()).toContain('50%')
  })

  it('⚠ 没样本的组合标「无样本」，不显示成零误差', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('无样本')
    expect(wrapper.text()).toContain('K11+K12')
  })

  it('逐条对比里区间没盖住实际值的行标出来，并给出折号', async () => {
    const wrapper = await open()
    // 第二条：实际 60 在 [20,40] 之外
    expect(wrapper.find('.text-state-warning').exists()).toBe(true)
    const headers = wrapper.findAll('th').map((node) => node.text())
    expect(headers).toContain('折')
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

  it('从未训练成功时不渲染折外区，实时测试也点不动', async () => {
    vi.mocked(hvac.getAcModel).mockResolvedValue(
      model({ metrics: null, trained_at: null, status: 'failed', error: 'x' }),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('还没有一次成功的训练')
    expect(wrapper.text()).not.toContain('折外总览')
    const live = wrapper
      .findAll('button')
      .find((item) => item.text() === '实时测试')
    expect(live?.attributes('disabled')).toBeDefined()
  })
})

describe('折外总览', () => {
  it('全量取数与分页表各走各的，脚注说清画了多少条', async () => {
    const wrapper = await open()
    expect(hvac.listModelPredictions).toHaveBeenCalledWith('m1', {
      page: 1,
      size: 200,
    })
    expect(hvac.listModelPredictions).toHaveBeenCalledWith('m1', {
      page: 1,
      size: 20,
    })
    expect(wrapper.text()).toContain('共 3 条折外预测，图上画了 3 条')
  })

  it('图例、误差分布与按折稳定性都在', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('热行漏盖')
    expect(wrapper.text()).toContain('误差分布（热行，p50 − 实际）')
    expect(wrapper.text()).toContain('按折稳定性（热行 MAE）')
    expect(wrapper.text()).toContain('误差最大的 5 次')
  })

  it('⚠ 有符号误差要说出偏差方向，不只说误差大', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('预测偏短')
  })

  it('散点下方的可见文字摘要给出漏盖比例', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain(
      '共 3 点，其中 1 点的 80% 区间未盖住实际值',
    )
  })

  it('切坐标刻度不重新取数', async () => {
    const wrapper = await open()
    const before = vi.mocked(hvac.listModelPredictions).mock.calls.length
    const compress = wrapper
      .findAll('button')
      .find((item) => item.text() === '压缩')
    await compress?.trigger('click')
    await flushPromises()
    expect(hvac.listModelPredictions).toHaveBeenCalledTimes(before)
  })

  it('取不回折外时整块换成错误提示并可重试', async () => {
    vi.mocked(hvac.listModelPredictions).mockRejectedValue(new Error('boom'))
    const wrapper = await open()
    expect(wrapper.text()).toContain('请求失败')
    const retry = wrapper
      .findAll('button')
      .find((item) => item.text() === '重试')
    await retry?.trigger('click')
    await flushPromises()
    expect(hvac.listModelPredictions).toHaveBeenCalled()
  })
})

describe('组合过滤', () => {
  it('⚠ 点按组合表的行写回同一个过滤器，逐条表跟着回第一页重取', async () => {
    const wrapper = await open()
    const row = wrapper.findAll('button').find((item) => item.text() === 'K11')
    await row?.trigger('click')
    await flushPromises()
    expect(hvac.listModelPredictions).toHaveBeenLastCalledWith('m1', {
      page: 1,
      size: 20,
      running_set: 'K11',
    })
    // 下拉与表的选中态同源
    expect(wrapper.find('[aria-pressed="true"]').exists()).toBe(true)
  })

  it('⚠ 无样本的组合不可点：藏起来等于说「这个组合没问题」', async () => {
    const wrapper = await open()
    const empty = wrapper
      .findAll('button')
      .find((item) => item.text() === 'K11+K12')
    expect(empty?.attributes('disabled')).toBeDefined()
  })

  it('从下拉换组合同样回第一页，组合键转成逗号分隔', async () => {
    await open()
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

describe('逐条表', () => {
  it('翻页与改每页条数各自重取，改条数回第一页', async () => {
    vi.mocked(hvac.listModelPredictions).mockResolvedValue({
      items: [prediction()],
      page: 1,
      size: 20,
      total: 120,
    })
    const wrapper = await open()
    const next = wrapper
      .findAll('button')
      .find((item) => item.text() === '下一页')
    await next?.trigger('click')
    await flushPromises()
    expect(hvac.listModelPredictions).toHaveBeenLastCalledWith('m1', {
      page: 2,
      size: 20,
    })
    const sizer = document.body.querySelector<HTMLSelectElement>('select')
    if (sizer !== null) {
      sizer.value = '50'
      sizer.dispatchEvent(new Event('change', { bubbles: true }))
      await flushPromises()
      expect(hvac.listModelPredictions).toHaveBeenLastCalledWith('m1', {
        page: 1,
        size: 50,
      })
    }
  })

  it('逐条取数失败时可就地重试，图与表各有各的重试键', async () => {
    vi.mocked(hvac.listModelPredictions).mockRejectedValue(new Error('boom'))
    const wrapper = await open()
    const retries = wrapper
      .findAll('button')
      .filter((item) => item.text() === '重试')
    // ④ 折外总览一颗、⑥ 逐条表一颗
    expect(retries.length).toBe(2)
    vi.mocked(hvac.listModelPredictions).mockResolvedValue(
      predictionPage([prediction()]),
    )
    const before = vi.mocked(hvac.listModelPredictions).mock.calls.length
    await retries.at(-1)?.trigger('click')
    await flushPromises()
    expect(
      vi.mocked(hvac.listModelPredictions).mock.calls.length,
    ).toBeGreaterThan(before)
    // 表恢复了；④ 那块仍旧红着，两处各自重试互不牵连
    expect(wrapper.findAll('tbody tr').length).toBeGreaterThan(0)
  })
})

describe('训练中', () => {
  it('轮询到终态即停，并刷新折外的两处取数', async () => {
    vi.useFakeTimers()
    vi.mocked(hvac.getAcModel)
      .mockResolvedValueOnce(model({ status: 'training' }))
      .mockResolvedValue(model())
    mount(DetailPage, { attachTo: document.body })
    await vi.advanceTimersByTimeAsync(0)
    expect(hvac.getAcModel).toHaveBeenCalledTimes(1)
    // 挂载时全量与分页各取一次
    expect(hvac.listModelPredictions).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(hvac.getAcModel).toHaveBeenCalledTimes(2)
    // 到终态：折外预测已被训练整体换掉，两处都跟着刷新
    expect(hvac.listModelPredictions).toHaveBeenCalledTimes(4)
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

  it('⚠ 只读账号看不到重训与删除，但实时测试保留（纯计算读操作）', async () => {
    setActivePinia(createPinia())
    signIn(['ac:view'])
    const wrapper = await open()
    expect(wrapper.text()).not.toContain('重训')
    expect(wrapper.text()).not.toContain('删除')
    expect(wrapper.text()).toContain('实时测试')
  })
})
