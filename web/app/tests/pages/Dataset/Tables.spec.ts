/**
 * @fileoverview 数据台账列表页的行为契约：一行说清这张表是什么、**进得去详情**、
 * 闸 3 门禁、客户端搜索、两种空态，以及**两段式删除**——先不带 force 试一次，
 * 后端回 409 才升级成「仍然删除」。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DatasetTableSummary } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'

import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import { BizError } from '@/api/client'
import * as dataset from '@/api/dataset'
import TableFormDialog from '@/pages/Dataset/Tables/components/TableFormDialog.vue'
import TablesPage from '@/pages/Dataset/Tables/index.vue'
import { useAuthStore } from '@/stores/auth'

// ⚠ push 得是**同一个** spy：工厂里每次现 new 一个的话，断言看的和页面用的
// 不是一份，调用记录永远是空的
const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ path: '/datasets', query: {} }),
  // ⚠ 存根必须把 `to` 渲染成 href：丢掉它，「这个入口指向哪张台账」就无从断言，
  // 而这一页缺的正是这些入口
  RouterLink: {
    props: { to: { type: String, required: true } },
    template: '<a :href="to"><slot /></a>',
  },
}))

function table(over: Partial<DatasetTableSummary> = {}): DatasetTableSummary {
  return {
    id: 't1',
    code: 'energy_log',
    name: '一号机组能耗台账',
    description: '每小时一行，供能耗看板取数',
    collect_mode: 'aggregate',
    collect_interval_ms: 3_600_000,
    retention_days: null,
    last_collected_ts: null,
    is_enabled: true,
    column_count: 6,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  auth.accessToken = 'token'
}

function pageOf(items: DatasetTableSummary[], total = items.length) {
  return { items, page: 1, size: 200, total }
}

beforeEach(() => {
  setActivePinia(createPinia())
  // ⚠ 视图偏好落在 localStorage 里：不清的话上一条用例切过的视图会带进下一条，
  // 而用例顺序是随机的
  localStorage.clear()
  routerMock.push.mockClear()
  vi.spyOn(dataset, 'listDatasetTables').mockResolvedValue(pageOf([table()]))
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
  const wrapper = mount(TablesPage)
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

/** 点确认框上文案**恰好等于**这几个字的那个按钮。 */
async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  )
  button?.click()
  await flushPromises()
}

function notEmpty(rows: number): BizError {
  return new BizError(
    ERROR_CODES.datasetTableNotEmpty,
    `这张台账下还有 ${rows} 行数据`,
    409,
    'trace',
  )
}

describe('台账列表页', () => {
  it('一行里同时给出名称、编码、取数方式、列数与保留期', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('一号机组能耗台账')
    expect(wrapper.text()).toContain('energy_log')
    expect(wrapper.text()).toContain('自动采集 · 每 1 小时')
    expect(wrapper.text()).toContain('6')
    expect(wrapper.text()).toContain('永久')
  })

  it('台账名就是进详情的链接——不进详情配不了列，也配不了公式', async () => {
    const wrapper = await render(['dataset:view'])
    const link = wrapper
      .findAll('a')
      .find((node) => node.text() === '一号机组能耗台账')
    expect(link?.attributes('href')).toBe('/datasets/t1')
  })

  it('行尾另留一枚入口，且只读账号照样点得进去', async () => {
    const wrapper = await render(['dataset:view'])
    const entry = wrapper.find('[aria-label="配置列与查看数据"]')
    expect(entry.exists()).toBe(true)
    expect(entry.attributes('href')).toBe('/datasets/t1')
  })

  it('⚠ 一列都没有的台账标成「未配列」，那三个字直接去列配置', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue(
      pageOf([table({ column_count: 0 })]),
    )
    const wrapper = await render(['dataset:view'])
    const link = wrapper.findAll('a').find((node) => node.text() === '未配列')
    expect(link?.attributes('href')).toBe('/datasets/t1/columns')
  })

  it('配好了列就只报数目，不再多摆一句提示', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).not.toContain('未配列')
  })

  it('人工录入的台账不显示采集周期——它根本不按周期采', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue(
      pageOf([table({ collect_mode: 'manual' })]),
    )
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('人工录入')
    expect(wrapper.text()).not.toContain('每 1 小时')
  })

  it('停用的台账在列表上就看得出来', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue(
      pageOf([table({ is_enabled: false })]),
    )
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('停用')
  })

  it('只读账号看不到任何写入口，但被告知原因', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).not.toContain('新建台账')
    expect(wrapper.find('[aria-label="编辑台账"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="删除台账"]').exists()).toBe(false)
    // ⚠ 主按钮凭空不见时不解释，会变成一张「这个功能是不是没上线」的工单
    expect(wrapper.find('[data-test="perm-readonly"]').exists()).toBe(true)
  })

  it('持 dataset:manage 才出现新建与行内操作', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    expect(wrapper.text()).toContain('新建台账')
    expect(wrapper.find('[aria-label="编辑台账"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="删除台账"]').exists()).toBe(true)
    // 行内不挂「只读」标签：每行一句是纯噪音
    expect(wrapper.findAll('[data-test="perm-readonly"]')).toHaveLength(0)
  })

  it('搜索在本地筛，不再发一次请求', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue(
      pageOf([table(), table({ id: 't2', code: 'gas', name: '燃气台账' })]),
    )
    const wrapper = await render(['dataset:view'])
    const before = vi.mocked(dataset.listDatasetTables).mock.calls.length

    await wrapper.find('input[type="search"]').setValue('燃气')
    await flushPromises()

    expect(wrapper.text()).toContain('燃气台账')
    expect(wrapper.text()).not.toContain('一号机组能耗台账')
    expect(vi.mocked(dataset.listDatasetTables).mock.calls.length).toBe(before)
  })

  it('编码也在搜索范围内：大屏绑定键里露出来的是它，不是名称', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue(
      pageOf([table(), table({ id: 't2', code: 'gas', name: '燃气台账' })]),
    )
    const wrapper = await render(['dataset:view'])
    await wrapper.find('input[type="search"]').setValue('energy_log')
    await flushPromises()
    expect(wrapper.text()).toContain('一号机组能耗台账')
    expect(wrapper.text()).not.toContain('燃气台账')
  })

  it('⚠ 没取全时明说：本地筛只筛得到手上这一批', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue(
      pageOf([table()], 205),
    )
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('还有 204 张台账没取回来')
  })

  it('取全了就不摆那句提示', async () => {
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).not.toContain('没取回来')
  })
})

describe('两段式删除', () => {
  it('第一段只说会删掉列定义，且先不带 force 试一次', async () => {
    const remove = vi.spyOn(dataset, 'deleteDatasetTable').mockResolvedValue()
    const wrapper = await renderWithHosts(['dataset:view', 'dataset:manage'])
    await wrapper.find('[aria-label="删除台账"]').trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('全部列定义')
    expect(remove).not.toHaveBeenCalled()

    await clickInConfirm('删除')
    expect(remove).toHaveBeenCalledWith('t1')
    // 写完必须重取：不重取的话列表上那张已经不存在的表还在
    expect(dataset.listDatasetTables).toHaveBeenCalledTimes(2)
  })

  it('⚠ 后端回 409 时不算失败，而是把它给的行数原样问回去', async () => {
    const remove = vi
      .spyOn(dataset, 'deleteDatasetTable')
      .mockRejectedValueOnce(notEmpty(1240))
      .mockResolvedValueOnce()
    const wrapper = await renderWithHosts(['dataset:view', 'dataset:manage'])
    await wrapper.find('[aria-label="删除台账"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')

    expect(document.body.textContent).toContain('这张台账下还有 1240 行数据')
    expect(document.body.textContent).toContain('仍然删除')
    // 第二段还没确认，force 那一次不许提前发出去
    expect(remove).toHaveBeenCalledTimes(1)

    await clickInConfirm('仍然删除')
    expect(remove).toHaveBeenLastCalledWith('t1', true)
  })

  it('第二段点取消就到此为止，历史一行不动', async () => {
    const remove = vi
      .spyOn(dataset, 'deleteDatasetTable')
      .mockRejectedValue(notEmpty(9))
    const wrapper = await renderWithHosts(['dataset:view', 'dataset:manage'])
    await wrapper.find('[aria-label="删除台账"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')
    await clickInConfirm('取消')

    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalledWith('t1', true)
  })

  it('确认之后连 force 那次也失败时，如实说一句，不假装删掉了', async () => {
    const remove = vi
      .spyOn(dataset, 'deleteDatasetTable')
      .mockRejectedValueOnce(notEmpty(3))
      .mockRejectedValueOnce(new BizError(50000, '服务端开小差', 500, 'trace'))
    const wrapper = await renderWithHosts(['dataset:view', 'dataset:manage'])
    await wrapper.find('[aria-label="删除台账"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')
    await clickInConfirm('仍然删除')

    expect(remove).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain('服务端开小差')
    expect(document.body.textContent).not.toContain('台账已删除')
  })

  it('第一段点取消就什么都不做', async () => {
    const remove = vi.spyOn(dataset, 'deleteDatasetTable').mockResolvedValue()
    const wrapper = await renderWithHosts(['dataset:view', 'dataset:manage'])
    await wrapper.find('[aria-label="删除台账"]').trigger('click')
    await flushPromises()
    await clickInConfirm('取消')
    expect(remove).not.toHaveBeenCalled()
  })

  it('不是「还有数据」的失败照旧吐给用户，不会莫名其妙问第二遍', async () => {
    vi.spyOn(dataset, 'deleteDatasetTable').mockRejectedValue(
      new BizError(41201, '台账不存在', 404, 'trace'),
    )
    const wrapper = await renderWithHosts(['dataset:view', 'dataset:manage'])
    await wrapper.find('[aria-label="删除台账"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')

    expect(document.body.textContent).toContain('台账不存在')
    expect(document.body.textContent).not.toContain('仍然删除')
  })
})

describe('两种空态', () => {
  it('一张都没有时给的是「这东西是干什么的」，不是一句「暂无数据」', async () => {
    vi.mocked(dataset.listDatasetTables).mockResolvedValue(pageOf([]))
    const wrapper = await render(['dataset:view'])
    expect(wrapper.text()).toContain('还没有台账')
    expect(wrapper.text()).toContain('先建一张表，再给它配列')
  })

  it('⚠ 筛出来是空的时候不许再劝人建表：表早就建好了', async () => {
    const wrapper = await render(['dataset:view'])
    await wrapper.find('input[type="search"]').setValue('查无此表')
    await flushPromises()

    expect(wrapper.text()).toContain('没有匹配的台账')
    expect(wrapper.text()).not.toContain('先建一张表，再给它配列')
  })
})

describe('建表与改表', () => {
  it('点新建打开空表单', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    const button = wrapper
      .findAll('button')
      .find((node) => node.text().includes('新建台账'))
    await button?.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('新建台账')
    expect(document.body.textContent).toContain('先建表，再给它配列')
  })

  it('⚠ 建完直接进列配置：新表一列都没有，停在列表上等于让人再找一次入口', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    wrapper
      .findComponent(TableFormDialog)
      .vm.$emit('saved', '台账「新表」已创建', 'new-id')
    await flushPromises()
    expect(routerMock.push).toHaveBeenCalledWith('/datasets/new-id/columns')
  })

  it('改完不跳，就地重取——改个名字被扔进详情页是没道理的', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    wrapper.findComponent(TableFormDialog).vm.$emit('saved', '台账已更新', null)
    await flushPromises()
    expect(routerMock.push).not.toHaveBeenCalled()
    expect(dataset.listDatasetTables).toHaveBeenCalledTimes(2)
  })

  it('点编辑打开的是这一张，名称已经铺好', async () => {
    const wrapper = await render(['dataset:view', 'dataset:manage'])
    await wrapper.find('[aria-label="编辑台账"]').trigger('click')
    await flushPromises()
    const first = document.querySelector<HTMLInputElement>('.dt-input__el')
    expect(first?.value).toBe('一号机组能耗台账')
  })
})
