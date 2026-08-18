/**
 * @fileoverview 空间配置页的行为契约：房间画成容器、同房间的空调框在一起、
 * 空房间也要画、选中后能整批改派、换车间清掉选择、闸 3 门禁。
 *
 * ⚠ 「同房间的空调框在一起」是这一页存在的理由：归组错了两边都画得出来、
 * 台数也对得上，肉眼对不出来，只能靠用例按容器逐个数。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { AcUnit, Room, Workshop } from '@dt/contracts'

import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import SpacesPage from '@/pages/Hvac/Spaces/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/hvac/spaces', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const STAMP = '2026-01-01T00:00:00.000Z'

function workshop(id: string, name: string, rooms: number): Workshop {
  return {
    id,
    name,
    room_count: rooms,
    ac_unit_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function room(id: string, name: string, workshopId = 'w1'): Room {
  return {
    id,
    name,
    workshop: { id: workshopId, name: '东车间' },
    ac_unit_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function acUnit(id: string, serial: string, roomId: string): AcUnit {
  return {
    id,
    serial,
    name: `机 ${id}`,
    room: { id: roomId, name: '房' },
    workshop: { id: 'w1', name: '东车间' },
    created_at: STAMP,
    updated_at: STAMP,
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
  localStorage.clear()
  vi.spyOn(hvac, 'listWorkshops').mockResolvedValue({
    items: [workshop('w1', '东车间', 2), workshop('w2', '西车间', 0)],
    page: 1,
    size: 200,
    total: 2,
  })
  vi.spyOn(hvac, 'listRooms').mockImplementation((query = {}) =>
    Promise.resolve({
      items:
        query.workshop_id === 'w1'
          ? [room('r1', '注塑房'), room('r2', '装配房'), room('r3', '备件房')]
          : [],
      page: 1,
      size: 200,
      total: query.workshop_id === 'w1' ? 3 : 0,
    }),
  )
  vi.spyOn(hvac, 'listAcUnits').mockImplementation((query = {}) =>
    Promise.resolve({
      items:
        query.workshop_id === 'w1'
          ? [
              acUnit('a1', 'AC-1', 'r1'),
              acUnit('a2', 'AC-2', 'r1'),
              acUnit('a3', 'AC-3', 'r2'),
            ]
          : [],
      page: 1,
      size: 200,
      total: query.workshop_id === 'w1' ? 3 : 0,
    }),
  )
})

enableAutoUnmount(afterEach)

afterEach(() => {
  useToast().clear()
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

async function render(codes: string[]) {
  signIn(codes)
  const wrapper = mount(SpacesPage)
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

describe('空间配置页', () => {
  it('每个房间画成一个容器，空房间也照样画', async () => {
    const wrapper = await render(['ac:view'])
    const groups = wrapper.findAll('.room-group')
    expect(groups).toHaveLength(3)
    expect(wrapper.text()).toContain('注塑房')
    expect(wrapper.text()).toContain('装配房')
  })

  it('同一个房间的空调框在同一个容器里', async () => {
    const wrapper = await render(['ac:view'])
    const groups = wrapper.findAll('.room-group')
    const first = groups[0]?.findAll('.ac-chip').map((chip) => chip.text())
    const second = groups[1]?.findAll('.ac-chip').map((chip) => chip.text())
    expect(first?.join(' ')).toContain('AC-1')
    expect(first?.join(' ')).toContain('AC-2')
    expect(second?.join(' ')).toContain('AC-3')
    expect(second?.join(' ')).not.toContain('AC-1')
  })

  it('两台以上才提示热耦合——一台没有互相影响可言', async () => {
    const wrapper = await render(['ac:view'])
    const groups = wrapper.findAll('.room-group')
    expect(groups[0]?.text()).toContain('2 台')
    expect(groups[1]?.text()).toContain('1 台')
    expect(groups[0]?.find('[aria-label="热耦合"]').exists()).toBe(true)
    expect(groups[1]?.find('[aria-label="热耦合"]').exists()).toBe(false)
  })

  it('车间栏的两个计数取自后端，不按已加载的数据现数', async () => {
    const wrapper = await render(['ac:view'])
    expect(wrapper.text()).toContain('2 房')
  })

  it('只读账号看不到任何写入口，空调也点不动', async () => {
    const wrapper = await render(['ac:view'])
    expect(wrapper.text()).not.toContain('新建房间')
    expect(wrapper.find('[aria-label="删除房间"]').exists()).toBe(false)
    expect(wrapper.find('.ac-chip').attributes('disabled')).toBeDefined()
  })

  it('选中几台就出现改派条并报出台数', async () => {
    const wrapper = await render(['ac:view', 'ac:manage'])
    expect(wrapper.find('.relocate-bar').exists()).toBe(false)

    const chips = wrapper.findAll('.ac-chip')
    await chips[0]?.trigger('click')
    await chips[1]?.trigger('click')
    await flushPromises()
    expect(wrapper.find('.relocate-bar').text()).toContain('已选 2 台')
  })

  it('没选目标房间时改派按钮是禁用的', async () => {
    // 不禁用就会发出一条 room_id 为空的请求，后端 422，而人看到的是「操作失败」
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.findAll('.ac-chip')[0]?.trigger('click')
    await flushPromises()
    const submit = wrapper
      .findAll('.relocate-bar button')
      .find((node) => node.text().includes('改派到这个房间'))
    expect(submit?.attributes('disabled')).toBeDefined()
  })

  it('再点一次就取消选中', async () => {
    const wrapper = await render(['ac:view', 'ac:manage'])
    const chip = wrapper.findAll('.ac-chip')[0]
    await chip?.trigger('click')
    await flushPromises()
    expect(chip?.attributes('aria-pressed')).toBe('true')
    await chip?.trigger('click')
    await flushPromises()
    expect(wrapper.find('.relocate-bar').exists()).toBe(false)
  })

  it('选好目标房间才能改派，改派后清空选择并重取', async () => {
    const relocate = vi.spyOn(hvac, 'relocateAcUnits').mockResolvedValue({
      moved_count: 1,
      room: { id: 'r2', name: '装配房' },
      workshop: { id: 'w1', name: '东车间' },
    })
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.findAll('.ac-chip')[0]?.trigger('click')
    await flushPromises()
    await pickRoom(wrapper, '装配房')
    await clickByText(wrapper, '改派到这个房间')
    expect(relocate).toHaveBeenCalledWith(['a1'], 'r2')
    expect(wrapper.find('.relocate-bar').exists()).toBe(false)
  })

  it('换车间会清掉已选——留着的话「已选 N 台」指的是别的车间', async () => {
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.findAll('.ac-chip')[0]?.trigger('click')
    await flushPromises()
    expect(wrapper.find('.relocate-bar').exists()).toBe(true)

    await wrapper.findAll('.workshop-rail__pick')[1]?.trigger('click')
    await flushPromises()
    expect(wrapper.find('.relocate-bar').exists()).toBe(false)
  })

  it('删有空调的房间会先说清它会被后端拒绝', async () => {
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="删除房间"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('2 台空调')
  })

  it('删有房间的车间同样先说清', async () => {
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="删除 东车间"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('2 个房间')
  })

  it('新建车间填完名字就落库，并把两栏都重取', async () => {
    const create = vi
      .spyOn(hvac, 'createWorkshop')
      .mockResolvedValue(workshop('w3', '北车间', 0))
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="新建车间"]').trigger('click')
    await flushPromises()
    await typeName('北车间')
    await clickInBody('保存')
    expect(create).toHaveBeenCalledWith('北车间')
    // 车间栏的两个计数来自后端，写完不重取就一直是旧数
    expect(hvac.listWorkshops).toHaveBeenCalledTimes(2)
  })

  it('新建房间带着当前车间提交', async () => {
    const create = vi
      .spyOn(hvac, 'createRoom')
      .mockResolvedValue(room('r3', '打包房'))
    const wrapper = await render(['ac:view', 'ac:manage'])
    await clickInWrapper(wrapper, '新建房间')
    await typeName('打包房')
    await clickInBody('保存')
    expect(create).toHaveBeenCalledWith({
      workshop_id: 'w1',
      name: '打包房',
    })
  })

  it('重命名房间打开即带出现名', async () => {
    const update = vi
      .spyOn(hvac, 'updateRoom')
      .mockResolvedValue(room('r1', '注塑一房'))
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="重命名房间"]').trigger('click')
    await flushPromises()
    expect(nameInput()?.value).toBe('注塑房')
    await typeName('注塑一房')
    await clickInBody('保存')
    expect(update).toHaveBeenCalledWith('r1', { name: '注塑一房' })
  })

  it('确认后才真的删房间，删完两栏一起重取', async () => {
    const remove = vi.spyOn(hvac, 'deleteRoom').mockResolvedValue()
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    // 空房间才走得到确认这一步：里面还有空调的房间根本不该问（见下面那一组）
    await wrapper.findAll('[aria-label="删除房间"]')[2]?.trigger('click')
    await flushPromises()
    await clickInBody('删除')
    expect(remove).toHaveBeenCalledWith('r3')
    expect(hvac.listWorkshops).toHaveBeenCalledTimes(2)
  })

  it('确认后才真的删车间', async () => {
    const remove = vi.spyOn(hvac, 'deleteWorkshop').mockResolvedValue()
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="删除 西车间"]').trigger('click')
    await flushPromises()
    // 西车间是空的，措辞该是「不可恢复」而不是「会被拒绝」
    expect(document.body.textContent).toContain('不可恢复')
    await clickInBody('删除')
    expect(remove).toHaveBeenCalledWith('w2')
  })

  it('删除被后端拒绝时把原因吐给用户', async () => {
    // 前端拦不住的那类拒绝（并发改动、后端另有约束）仍要如实吐出来
    vi.spyOn(hvac, 'deleteRoom').mockRejectedValue(new Error('boom'))
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    await wrapper.findAll('[aria-label="删除房间"]')[2]?.trigger('click')
    await flushPromises()
    await clickInBody('删除')
    expect(document.body.textContent).toContain('请求失败')
  })

  it('改派失败时把原因吐给用户，选择不清空', async () => {
    vi.spyOn(hvac, 'relocateAcUnits').mockRejectedValue(new Error('boom'))
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])
    await wrapper.findAll('.ac-chip')[0]?.trigger('click')
    await flushPromises()
    await pickRoom(wrapper, '装配房')
    await clickInWrapper(wrapper, '改派到这个房间')
    expect(document.body.textContent).toContain('请求失败')
    expect(wrapper.find('.relocate-bar').exists()).toBe(true)
  })

  it('车间列表取回失败时说出来，且不去取房间', async () => {
    vi.mocked(hvac.listWorkshops).mockRejectedValue(new Error('boom'))
    const wrapper = await render(['ac:view'])
    expect(wrapper.text()).toContain('先选一个车间')
    expect(hvac.listRooms).not.toHaveBeenCalled()
  })

  it('重命名车间打开即带出现名并走 updateWorkshop', async () => {
    const update = vi
      .spyOn(hvac, 'updateWorkshop')
      .mockResolvedValue(workshop('w1', '东一车间', 2))
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="重命名 东车间"]').trigger('click')
    await flushPromises()
    expect(nameInput()?.value).toBe('东车间')
    await typeName('东一车间')
    await clickInBody('保存')
    expect(update).toHaveBeenCalledWith('w1', '东一车间')
  })

  it('弹窗点取消不发请求', async () => {
    const create = vi.spyOn(hvac, 'createWorkshop')
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="新建车间"]').trigger('click')
    await flushPromises()
    await clickInBody('取消')
    expect(create).not.toHaveBeenCalled()
    expect(nameInput()).toBeNull()
  })

  it('取数失败时给的是重试，不是一个空白面板', async () => {
    vi.mocked(hvac.listRooms).mockRejectedValue(new Error('boom'))
    const wrapper = await render(['ac:view'])
    expect(wrapper.text()).toContain('重试')
    vi.mocked(hvac.listRooms).mockResolvedValue({
      items: [room('r1', '注塑房')],
      page: 1,
      size: 200,
      total: 1,
    })
    await clickInWrapper(wrapper, '重试')
    expect(wrapper.findAll('.room-group')).toHaveLength(1)
  })

  it('房间或空调没取全时明说，不静默少画', async () => {
    vi.mocked(hvac.listAcUnits).mockResolvedValue({
      items: [acUnit('a1', 'AC-1', 'r1')],
      page: 1,
      size: 200,
      total: 260,
    })
    const wrapper = await render(['ac:view'])
    expect(wrapper.text()).toContain('空调 1/260')
  })

  it('重名被拒时弹窗留在原地并说明原因', async () => {
    vi.spyOn(hvac, 'createWorkshop').mockRejectedValue(new Error('boom'))
    const wrapper = await render(['ac:view', 'ac:manage'])
    await wrapper.find('[aria-label="新建车间"]').trigger('click')
    await flushPromises()
    await typeName('东车间')
    await clickInBody('保存')
    // 关掉窗就等于把用户刚输入的东西一起丢了
    expect(nameInput()).not.toBeNull()
  })
})

function nameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('.dt-input__el')
}

async function typeName(value: string): Promise<void> {
  const field = nameInput()
  if (field === null) throw new Error('名称输入框不存在')
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

async function clickInBody(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.trim().includes(text),
  )
  button?.click()
  await flushPromises()
}

async function clickInWrapper(
  wrapper: ReturnType<typeof mount>,
  text: string,
): Promise<void> {
  const button = wrapper
    .findAll('button')
    .find((node) => node.text().includes(text))
  await button?.trigger('click')
  await flushPromises()
}

/** 在改派条的房间选择器里挑一个。DtSelect 的浮层 teleport 在 body 上。 */
async function pickRoom(
  wrapper: ReturnType<typeof mount>,
  label: string,
): Promise<void> {
  await wrapper.find('.relocate-bar .dt-select__trigger').trigger('click')
  await flushPromises()
  const option = [...document.querySelectorAll('.dt-select-menu__item')].find(
    (node) => node.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
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

describe('删不成的时候不问，直接说清下一步', () => {
  // ⚠ 摆一个红色「删除」去发一个注定被拒的请求，等于教人做一件做不成的事：
  // 用户点完只换来一条报错，而他真正需要的是「先做什么」
  it('房间里还有空调时不弹确认，也不发请求', async () => {
    const remove = vi.spyOn(hvac, 'deleteRoom').mockResolvedValue()
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])

    await wrapper.findAll('[aria-label="删除房间"]')[0]?.trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('先把它们改派到别的房间')
    expect(document.body.textContent).not.toContain('不可恢复')
  })

  it('车间下还有房间时不弹确认，也不发请求', async () => {
    const remove = vi.spyOn(hvac, 'deleteWorkshop').mockResolvedValue()
    const wrapper = await renderWithHosts(['ac:view', 'ac:manage'])

    await wrapper.find('[aria-label="删除 东车间"]').trigger('click')
    await flushPromises()

    expect(remove).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('先把房间移走或删掉')
  })
})
