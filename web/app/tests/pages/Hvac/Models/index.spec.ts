/**
 * @fileoverview 模型列表页的行为契约：行与提示、权限门、重训与删除、
 * 训练中轮询到终态即停。
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

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: pushMock }),
  useRoute: () => ({ path: '/hvac/models', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function room(id: string, name: string, units: number): Room {
  return {
    id,
    name,
    workshop: { id: 'w1', name: '东车间' },
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
  vi.spyOn(hvac, 'listAcModels').mockResolvedValue([model()])
  vi.spyOn(hvac, 'listRooms').mockResolvedValue(page([room('r1', '注塑房', 2)]))
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

/** 确认框 Teleport 到 body：在弹层范围内点确认钮，避开行里的同名按钮。 */
async function clickConfirm(): Promise<void> {
  const dialog = document.querySelector('[role="dialog"]') ?? document.body
  const buttons = [...dialog.querySelectorAll('button')]
  const accept = buttons.find((node) => node.textContent?.includes('删除'))
  accept?.click()
  await flushPromises()
}

describe('列表', () => {
  it('行里给出名称、房间、状态与折外指标', async () => {
    const wrapper = await open()
    expect(wrapper.text()).toContain('早班模型')
    expect(wrapper.text()).toContain('注塑房')
    expect(wrapper.text()).toContain('就绪')
    expect(wrapper.text()).toContain('4.2 分钟')
    expect(wrapper.text()).toContain('82%')
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
  })
})

describe('操作', () => {
  it('点名称进详情', async () => {
    const wrapper = await open()
    await wrapper.find('button.text-accent-primary').trigger('click')
    expect(pushMock).toHaveBeenCalledWith('/hvac/models/m1')
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
})
