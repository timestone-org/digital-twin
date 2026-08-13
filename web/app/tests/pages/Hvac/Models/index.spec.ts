/**
 * @fileoverview 模型列表页的行为契约：左栏选房间与 URL 记忆、右区行与提示、
 * 权限门、重训与删除、排序、训练中轮询到终态即停。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { Page, Room } from '@dt/contracts'
import { DtConfirmHost, DtToastHost, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import CreateModelDialog from '@/pages/Hvac/Models/components/CreateModelDialog.vue'
import ModelsPage from '@/pages/Hvac/Models/index.vue'
import { useAuthStore } from '@/stores/auth'
import { STAMP, model } from '@/testing/modelFixtures'

const pushMock = vi.fn()
const replaceMock = vi.fn()
const query: Record<string, string> = {}

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  useRoute: () => ({ path: '/hvac/models', query }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function room(
  id: string,
  name: string,
  units: number,
  workshop = { id: 'w1', name: '东车间' },
): Room {
  return {
    id,
    name,
    workshop,
    ac_unit_count: units,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function page<TItem>(items: TItem[]): Page<TItem> {
  return { items, page: 1, size: 200, total: items.length }
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
  useToast().clear()
  pushMock.mockClear()
  replaceMock.mockClear()
  for (const key of Object.keys(query)) delete query[key]
  vi.spyOn(hvac, 'listAcModels').mockResolvedValue([model()])
  vi.spyOn(hvac, 'listRooms').mockResolvedValue(page([room('r1', '注塑房', 2)]))
  // 新建对话框一打开就取覆盖度；不打桩会真去 fetch
  vi.spyOn(hvac, 'getStartupBatches').mockResolvedValue({
    items: [],
    current: null,
    coverage: [],
    expected_fingerprint: 'fp',
    is_stale: false,
    source_range: null,
  })
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function open() {
  const wrapper = mount(ModelsPage, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

/** 右区模型名那颗链接按钮；左栏选中的房间也带 accent 色，不能混。 */
function nameButton(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('button').find((item) => item.text() === '早班模型')
}

/** 确认框 Teleport 到 body：在弹层范围内点确认钮，避开行里的同名按钮。 */
async function clickConfirm(): Promise<void> {
  const dialog = document.querySelector('[role="dialog"]') ?? document.body
  const buttons = [...dialog.querySelectorAll('button')]
  const accept = buttons.find((node) => node.textContent?.includes('删除'))
  accept?.click()
  await flushPromises()
}

describe('列表', () => {
  it('行里给出名称、状态、样本与热行指标', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('早班模型')
    expect(wrapper.text()).toContain('就绪')
    expect(wrapper.text()).toContain('4.2 分钟')
    expect(wrapper.text()).toContain('覆盖 82%')
    expect(wrapper.text()).toContain('热 80 · 零 40')
  })

  it('⚠ R² 算不出时渲染破折号而不是 0.00', async () => {
    const base = model()
    if (base.metrics === null) throw new Error('夹具里应有评估')
    const hot = base.metrics.overall.hot
    if (hot === null) throw new Error('夹具里应有热行')
    vi.mocked(hvac.listAcModels).mockResolvedValue([
      model({
        metrics: {
          ...base.metrics,
          overall: { ...base.metrics.overall, hot: { ...hot, r2: null } },
        },
      }),
    ])
    const wrapper = await open()
    expect(wrapper.text()).not.toContain('0.00')
    expect(wrapper.find('.text-text-disabled').exists()).toBe(true)
  })

  it('失败的行把人话原因亮出来', async () => {
    vi.mocked(hvac.listAcModels).mockResolvedValue([
      model({ status: 'failed', error: '可用事件只有 5 条', metrics: null }),
    ])
    const wrapper = await open()
    expect(wrapper.text()).toContain('可用事件只有 5 条')
  })

  it('数据已更新的行给出重训提示', async () => {
    vi.mocked(hvac.listAcModels).mockResolvedValue([
      model({ is_batch_stale: true }),
    ])
    const wrapper = await open()
    expect(wrapper.text()).toContain('数据已更新')
  })

  it('取不回来时说出原因并可重试', async () => {
    vi.mocked(hvac.listAcModels).mockRejectedValue(new Error('boom'))
    const wrapper = await open()
    expect(wrapper.text()).toContain('请求失败')
    const retry = wrapper
      .findAll('button')
      .find((item) => item.text() === '重试')
    await retry?.trigger('click')
    await flushPromises()
    expect(hvac.listAcModels).toHaveBeenCalledTimes(2)
  })

  it('默认序是最新建的在最上，点表头改按样本排', async () => {
    vi.mocked(hvac.listAcModels).mockResolvedValue([
      model({
        id: 'm1',
        name: '早班模型',
        sample_count: 900,
        created_at: '2026-03-01T00:00:00.000Z',
      }),
      model({
        id: 'm2',
        name: '夜班模型',
        sample_count: 10,
        created_at: '2026-01-01T00:00:00.000Z',
      }),
    ])
    const wrapper = await open()
    const names = (): string[] =>
      wrapper
        .findAll('td button.text-accent-primary')
        .map((item) => item.text())
    expect(names()).toEqual(['早班模型', '夜班模型'])
    const header = wrapper
      .findAll('button')
      .find((item) => item.text() === '样本')
    await header?.trigger('click')
    await flushPromises()
    expect(names()).toEqual(['夜班模型', '早班模型'])
  })
})

describe('视图切换', () => {
  it('窄屏用户可以切到卡片视图，同一份单元格插槽喂两种视图', async () => {
    const wrapper = await open()
    expect(wrapper.find('table').exists()).toBe(true)
    const toCard = wrapper.find('button[aria-label="卡片视图"]')
    await toCard.trigger('click')
    await flushPromises()
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).toContain('早班模型')
    expect(wrapper.text()).toContain('4.2 分钟')
  })
})

describe('左栏', () => {
  it('按车间分组列房间与模型数，训练中的房间带圆点', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue(
      page([
        room('r1', '注塑房', 2),
        room('r2', '喷涂房', 1, { id: 'w2', name: '西车间' }),
      ]),
    )
    vi.mocked(hvac.listAcModels).mockResolvedValue([
      model({ status: 'training' }),
    ])
    const wrapper = await open()
    expect(wrapper.text()).toContain('东车间')
    expect(wrapper.text()).toContain('西车间')
    expect(wrapper.find('[aria-label="有模型正在训练"]').exists()).toBe(true)
  })

  it('⚠ 没有空调的房间不进栏，但要在栏底说清少了几个', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue(
      page([room('r1', '注塑房', 2), room('r9', '仓库', 0)]),
    )
    const wrapper = await open()
    expect(wrapper.text()).toContain('另有 1 个房间没有空调，不能建模')
  })

  it('选中的房间有 aria-pressed，点另一个会换右区', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue(
      page([room('r1', '注塑房', 2), room('r2', '喷涂房', 1)]),
    )
    const wrapper = await open()
    const pressed = wrapper.findAll(
      'nav[aria-label="房间"] [aria-pressed="true"]',
    )
    expect(pressed).toHaveLength(1)
    expect(pressed[0]?.text()).toContain('注塑房')
    const other = wrapper
      .findAll('button')
      .find((item) => item.text().includes('喷涂房'))
    await other?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('这个房间还没有模型')
  })

  it('⚠ 选中房间写进 query 用 replace 不用 push，后退键才不会被灌满', async () => {
    await open()
    expect(replaceMock).toHaveBeenCalledWith({ query: { room: 'r1' } })
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('地址栏带来的房间存在就用它，且不再多写一次 query', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue(
      page([room('r1', '注塑房', 2), room('r2', '喷涂房', 1)]),
    )
    query['room'] = 'r2'
    const wrapper = await open()
    expect(replaceMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('喷涂房')
  })

  it('⚠ 指向不存在的房间时静默兜底，不报错也不弹 toast', async () => {
    query['room'] = 'ghost'
    const wrapper = await open()
    expect(replaceMock).toHaveBeenCalledWith({ query: { room: 'r1' } })
    expect(wrapper.text()).toContain('早班模型')
  })

  it('一个房间都没有时两边都给空态', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue(page([]))
    vi.mocked(hvac.listAcModels).mockResolvedValue([])
    const wrapper = await open()
    expect(wrapper.text()).toContain('还没有配置房间')
    expect(wrapper.text()).toContain('先配置房间')
    expect(wrapper.text()).not.toContain('新建模型')
  })
})

describe('权限门', () => {
  it('只读账号看不到新建、重训与删除', async () => {
    setActivePinia(createPinia())
    signIn(['ac:view'])
    const wrapper = await open()
    expect(wrapper.text()).not.toContain('新建模型')
    expect(wrapper.text()).not.toContain('重训')
    expect(wrapper.text()).not.toContain('删除')
    expect(wrapper.text()).toContain('详情')
  })
})

describe('操作', () => {
  it('点名称进详情', async () => {
    const wrapper = await open()
    await nameButton(wrapper)?.trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/hvac/models/m1')
  })

  it('新建对话框拿当前房间预填', async () => {
    const wrapper = await open()
    const create = wrapper
      .findAll('button')
      .find((item) => item.text() === '新建模型')
    await create?.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(CreateModelDialog).props('roomId')).toBe('r1')
  })

  it('⚠ 房间的空调被挪走后不预填：它不在对话框的房间选项里', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue(page([room('r1', '注塑房', 0)]))
    const wrapper = await open()
    expect(wrapper.text()).toContain('早班模型')
    expect(wrapper.findComponent(CreateModelDialog).props('roomId')).toBe('')
  })

  it('重训入队后提示并刷新', async () => {
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
    expect(hvac.listAcModels).toHaveBeenCalledTimes(2)
  })

  it('删除要过确认，取消就不发请求', async () => {
    vi.spyOn(hvac, 'deleteAcModel').mockResolvedValue(undefined)
    const wrapper = mount(
      {
        components: { ModelsPage, DtConfirmHost, DtToastHost },
        template: '<ModelsPage /><DtConfirmHost /><DtToastHost />',
      },
      { attachTo: document.body },
    )
    await flushPromises()
    const remove = wrapper
      .findAll('button')
      .find((item) => item.text() === '删除')
    await remove?.trigger('click')
    await flushPromises()
    const cancel = wrapper
      .findAll('button')
      .find((item) => item.text() === '取消')
    await cancel?.trigger('click')
    await flushPromises()
    expect(hvac.deleteAcModel).not.toHaveBeenCalled()
  })
})

describe('操作·续', () => {
  it('删除过确认后真删并刷新', async () => {
    vi.spyOn(hvac, 'deleteAcModel').mockResolvedValue(undefined)
    const wrapper = mount(
      {
        components: { ModelsPage, DtConfirmHost, DtToastHost },
        template: '<ModelsPage /><DtConfirmHost /><DtToastHost />',
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
    expect(hvac.listAcModels).toHaveBeenCalledTimes(2)
  })

  it('重训失败把原因弹出来', async () => {
    vi.spyOn(hvac, 'retrainAcModel').mockRejectedValue(new Error('409'))
    const wrapper = mount(
      {
        components: { ModelsPage, DtToastHost },
        template: '<ModelsPage /><DtToastHost />',
      },
      { attachTo: document.body },
    )
    await flushPromises()
    const retrain = wrapper
      .findAll('button')
      .find((item) => item.text() === '重训')
    await retrain?.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('请求失败')
  })

  it('对话框建成后跳到新模型详情', async () => {
    const wrapper = await open()
    const dialog = wrapper.findComponent(CreateModelDialog)
    dialog.vm.$emit('created', 'm9')
    await flushPromises()
    expect(pushMock).toHaveBeenCalledWith('/hvac/models/m9')
  })
})

describe('训练中轮询', () => {
  it('有 queued/training 的行才轮询，全部到终态即停', async () => {
    vi.useFakeTimers()
    vi.mocked(hvac.listAcModels)
      .mockResolvedValueOnce([model({ status: 'training', metrics: null })])
      .mockResolvedValue([model()])
    mount(ModelsPage, { attachTo: document.body })
    await vi.advanceTimersByTimeAsync(0)
    expect(hvac.listAcModels).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(hvac.listAcModels).toHaveBeenCalledTimes(2)
    // 已到终态：再走几个周期也不该有新请求
    await vi.advanceTimersByTimeAsync(15000)
    expect(hvac.listAcModels).toHaveBeenCalledTimes(2)
  })

  it('⚠ 轮询刷新不重置左栏选中', async () => {
    vi.useFakeTimers()
    vi.mocked(hvac.listRooms).mockResolvedValue(
      page([room('r1', '注塑房', 2), room('r2', '喷涂房', 1)]),
    )
    vi.mocked(hvac.listAcModels).mockResolvedValue([
      model({ status: 'training' }),
    ])
    const wrapper = mount(ModelsPage, { attachTo: document.body })
    await vi.advanceTimersByTimeAsync(0)
    const other = wrapper
      .findAll('button')
      .find((item) => item.text().includes('喷涂房'))
    await other?.trigger('click')
    await vi.advanceTimersByTimeAsync(5000)
    expect(wrapper.text()).toContain('喷涂房')
    expect(wrapper.text()).toContain('这个房间还没有模型')
  })
})
