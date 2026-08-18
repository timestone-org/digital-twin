/**
 * @fileoverview 空调台账页的行为契约：列表渲染、闸 3 门禁、按位置筛选会带上
 * 过滤参数、删除必须二次确认、写完重取。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { AcUnit, Room, Workshop } from '@dt/contracts'

import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import UnitsPage from '@/pages/Hvac/Units/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/hvac/units', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

function acUnit(over: Partial<AcUnit> = {}): AcUnit {
  return {
    id: 'a1',
    serial: 'AC-A-101',
    name: '东侧机',
    room: { id: 'r1', name: '注塑房' },
    workshop: { id: 'w1', name: '东车间' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function workshop(): Workshop {
  return {
    id: 'w1',
    name: '东车间',
    room_count: 1,
    ac_unit_count: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

function room(): Room {
  return {
    id: 'r1',
    name: '注塑房',
    workshop: { id: 'w1', name: '东车间' },
    ac_unit_count: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  // ⚠ 视图偏好落在 localStorage 里：不清的话上一条用例切过的视图会带进下一条，
  // 而用例顺序是随机的
  localStorage.clear()
  vi.spyOn(hvac, 'listAcUnits').mockResolvedValue({
    items: [acUnit()],
    page: 1,
    size: 20,
    total: 1,
  })
  vi.spyOn(hvac, 'listWorkshops').mockResolvedValue({
    items: [workshop()],
    page: 1,
    size: 200,
    total: 1,
  })
  vi.spyOn(hvac, 'listRooms').mockResolvedValue({
    items: [room()],
    page: 1,
    size: 200,
    total: 1,
  })
})

// ⚠ 必须自动卸载：确认框与吐司宿主 teleport 到 body 上，上一条不卸载就清 body，
// 下一次更新会撞上已被摘掉的容器
enableAutoUnmount(afterEach)

afterEach(() => {
  useToast().clear()
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

async function render(codes: string[]) {
  signIn(codes)
  const wrapper = mount(UnitsPage)
  await flushPromises()
  return wrapper
}

async function renderWithHosts(codes: string[]) {
  const wrapper = await render(codes)
  mount(DtConfirmHost)
  mount(DtToastHost)
  await flushPromises()
  return wrapper
}

async function clickByText(
  wrapper: ReturnType<typeof mount>,
  text: string,
): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find((node) => node.text().includes(text))
  await button?.trigger('click')
  await flushPromises()
}

/** 在第 n 个 DtSelect 里点一个选项。DtSelect 的浮层 teleport 在 body 上。 */
async function pickInSelect(
  wrapper: ReturnType<typeof mount>,
  index: number,
  label: string,
): Promise<void> {
  await wrapper.findAll('.dt-select__trigger')[index]?.trigger('click')
  await flushPromises()
  const option = [...document.querySelectorAll('.dt-select-menu__item')].find(
    (node) => node.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  button?.click()
  await flushPromises()
}

describe('空调台账页', () => {
  it('一行里同时给出序号、名称与逐级展开的所属位置', async () => {
    const wrapper = await render(['ac:view'])
    expect(wrapper.text()).toContain('AC-A-101')
    expect(wrapper.text()).toContain('东侧机')
    expect(wrapper.text()).toContain('东车间')
    expect(wrapper.text()).toContain('注塑房')
  })

  it('只读账号看不到任何写入口', async () => {
    const wrapper = await render(['ac:view'])
    expect(wrapper.text()).not.toContain('新建空调')
    expect(wrapper.find('[aria-label="编辑空调"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="删除空调"]').exists()).toBe(false)
    // 数据与达标整个是 manage-only：连可绑定对象的清单都会暴露外库结构
    expect(wrapper.find('[aria-label="数据与达标"]').exists()).toBe(false)
  })

  it('持 ac:manage 才出现新建与行内操作', async () => {
    const wrapper = await render(['ac:view', 'ac:manage'])
    expect(wrapper.text()).toContain('新建空调')
    expect(wrapper.find('[aria-label="编辑空调"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="数据与达标"]').exists()).toBe(true)
  })

  it('点数据与达标打开的是这一台的配置', async () => {
    vi.spyOn(hvac, 'listAcDatasets').mockResolvedValue([])
    vi.spyOn(hvac, 'listAcDataBindings').mockResolvedValue([])
    vi.spyOn(hvac, 'listAcMetricLimits').mockResolvedValue([])
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="数据与达标"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('数据与达标 · AC-A-101')
    expect(hvac.listAcDataBindings).toHaveBeenCalledWith('a1')
  })

  it('进页面就把车间选项拉回来，供筛选与建档共用', async () => {
    await render(['ac:view'])
    expect(hvac.listWorkshops).toHaveBeenCalled()
  })

  it('没选车间时房间选择器是禁用的', async () => {
    // 全场同名房间是常态，只给房间名分不出是哪一间
    const wrapper = await render(['ac:view'])
    const triggers = wrapper.findAll('.dt-select__trigger')
    expect(triggers[1]?.attributes('disabled')).toBeDefined()
  })

  it('删除必须二次确认，且确认框说清楚会发生什么', async () => {
    const remove = vi.spyOn(hvac, 'deleteAcUnit').mockResolvedValue()
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="删除空调"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('不可恢复')
    expect(remove).not.toHaveBeenCalled()

    await clickInConfirm('删除')
    expect(remove).toHaveBeenCalledWith('a1')
    // 写完必须重取：不重取的话列表上那台已经不存在的机器还在
    expect(hvac.listAcUnits).toHaveBeenCalledTimes(2)
  })

  it('确认框点取消就什么都不做', async () => {
    const remove = vi.spyOn(hvac, 'deleteAcUnit').mockResolvedValue()
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="删除空调"]').trigger('click')
    await flushPromises()
    await clickInConfirm('取消')
    expect(remove).not.toHaveBeenCalled()
  })

  it('点新建打开空表单', async () => {
    const wrapper = await render(['ac:view', 'ac:manage'])
    await clickByText(wrapper, '新建空调')
    expect(document.body.textContent).toContain('新建空调')
    expect(document.body.textContent).toContain('全场唯一的设备编号')
  })

  it('点编辑打开的是这一台，序号已经铺好', async () => {
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="编辑空调"]').trigger('click')
    await flushPromises()
    const first = document.querySelector<HTMLInputElement>('.dt-input__el')
    expect(first?.value).toBe('AC-A-101')
  })

  it('换车间筛选会带上 workshop_id 重新取数', async () => {
    const wrapper = await render(['ac:view'])
    await pickInSelect(wrapper, 0, '东车间')
    expect(hvac.listAcUnits).toHaveBeenLastCalledWith(
      expect.objectContaining({ workshop_id: 'w1' }),
    )
  })

  it('选定车间后房间选择器才解禁，选了就一起带上', async () => {
    const wrapper = await render(['ac:view'])
    await pickInSelect(wrapper, 0, '东车间')
    await pickInSelect(wrapper, 1, '注塑房')
    expect(hvac.listAcUnits).toHaveBeenLastCalledWith(
      expect.objectContaining({ workshop_id: 'w1', room_id: 'r1' }),
    )
  })

  it('搜索要等打字停下来才发请求', async () => {
    // 边打字边发会把一次输入变成七八次查询，而只有最后一次的结果有用
    // ⚠ 不用 runAllTimers：UI 组件自己也在排定时器，跑到底会被判成死循环
    vi.useFakeTimers()
    try {
      signIn(['ac:view'])
      const wrapper = mount(UnitsPage)
      await flushPromises()
      const before = vi.mocked(hvac.listAcUnits).mock.calls.length

      await wrapper.find('input[type="search"]').setValue('AC')
      await flushPromises()
      expect(vi.mocked(hvac.listAcUnits).mock.calls.length).toBe(before)

      await vi.advanceTimersByTimeAsync(400)
      expect(hvac.listAcUnits).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'AC' }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('删除被后端拒绝时把原因吐给用户', async () => {
    vi.spyOn(hvac, 'deleteAcUnit').mockRejectedValue(new Error('boom'))
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="删除空调"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')
    expect(document.body.textContent).toContain('请求失败')
  })

  it('空态告诉人先去建车间与房间，而不是只说没有数据', async () => {
    vi.mocked(hvac.listAcUnits).mockResolvedValue({
      items: [],
      page: 1,
      size: 20,
      total: 0,
    })
    const wrapper = await render(['ac:view'])
    expect(wrapper.text()).toContain('空间配置')
  })
})

describe('两种空态', () => {
  it('台账真是空的时候，引导先去建车间与房间', async () => {
    vi.mocked(hvac.listAcUnits).mockResolvedValue({
      items: [],
      page: 1,
      size: 20,
      total: 0,
    })
    const wrapper = await render(['ac:view'])

    expect(wrapper.text()).toContain('还没有空调')
  })

  it('⚠ 筛出来是空的时候不许说「先去建车间」：车间早就建好了', async () => {
    vi.mocked(hvac.listAcUnits).mockResolvedValue({
      items: [],
      page: 1,
      size: 20,
      total: 0,
    })
    const wrapper = await render(['ac:view'])

    await pickInSelect(wrapper, 0, '东车间')
    await flushPromises()

    expect(wrapper.text()).toContain('没有匹配的空调')
    // ⚠ 断在引导原文上：「空间配置」四个字在左侧导航里也有一条同名菜单
    expect(wrapper.text()).not.toContain('再来这里逐台建档')
  })
})
