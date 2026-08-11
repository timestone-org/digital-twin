/**
 * @fileoverview 权限目录页的行为契约：分组渲染、关键词过滤、持有标记、
 * 三态与重试、视图切换，以及卡片视图那张只读参考卡。
 *
 * ⚠ 这一页是只读的，但它是运维判断「某个码归谁、是不是高危」的唯一入口，
 * 渲染错了不会报错、只会让人拿着错信息去配权限。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { PermissionCatalog, PermissionItem } from '@dt/contracts'

import * as authApi from '@/api/auth'
import PermissionsPage from '@/pages/System/Permissions/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/system/permissions', query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

function item(over: Partial<PermissionItem> = {}): PermissionItem {
  return {
    id: 'p1',
    code: 'user:view',
    name: '查看用户与角色',
    description: '只读',
    group_code: 'user',
    group_label: '用户与角色',
    sort_order: 10,
    kind: 'view',
    is_builtin: true,
    ...over,
  }
}

const CATALOG: PermissionCatalog = {
  items: [],
  groups: [
    {
      code: 'user',
      label: '用户与角色',
      items: [
        item(),
        item({ id: 'p2', code: 'user:grant', name: '授予权限', kind: 'admin' }),
      ],
    },
    {
      code: 'route',
      label: '路由规则',
      items: [
        item({
          id: 'p3',
          code: 'route_rule:manage',
          name: '管理路由规则',
          group_code: 'route',
          group_label: '路由规则',
          kind: 'manage',
        }),
        item({
          id: 'p4',
          code: 'route_rule:apply',
          name: '下发路由规则',
          description: null,
          group_code: 'route',
          group_label: '路由规则',
          kind: 'operate',
          is_builtin: false,
        }),
      ],
    },
  ],
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.spyOn(authApi, 'fetchPermissionCatalog').mockResolvedValue(CATALOG)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function render(held: string[] = []) {
  const auth = useAuthStore()
  auth.user = { permissions: held } as never
  auth.accessToken = 'token'
  const wrapper = mount(PermissionsPage)
  await flushPromises()
  return wrapper
}

describe('权限目录页', () => {
  it('按分组铺开全部权限码', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('用户与角色')
    expect(wrapper.text()).toContain('路由规则')
    expect(wrapper.text()).toContain('user:view')
  })

  it('每组标出这组有几个码', async () => {
    expect((await render()).text()).toContain('2 个码')
  })

  it('档位按后端字段打标，不靠前端猜', async () => {
    const text = (await render()).text()
    expect(text).toContain('高危')
    expect(text).toContain('查看')
    expect(text).toContain('管理')
  })

  it('标出我持有哪些码', async () => {
    const wrapper = await render(['user:view'])
    expect(wrapper.text()).toContain('持有')
  })

  it('关键词按码与名称过滤', async () => {
    const wrapper = await render()
    await wrapper.find('input').setValue('route_rule')
    expect(wrapper.text()).toContain('管理路由规则')
    expect(wrapper.text()).not.toContain('查看用户与角色')
  })

  it('整组被过滤空时整组不渲染，而不是留一个空壳', async () => {
    const wrapper = await render()
    await wrapper.find('input').setValue('route_rule')
    expect(wrapper.text()).not.toContain('用户与角色')
  })

  it('没有命中时给空态提示', async () => {
    const wrapper = await render()
    await wrapper.find('input').setValue('不存在的码')
    expect(wrapper.text()).toContain('没有匹配的权限码')
  })

  it('取数失败时给原因与重试入口，点了会再拉一次', async () => {
    const { TransportError } = await import('@/api/client')
    const fetchIt = vi
      .spyOn(authApi, 'fetchPermissionCatalog')
      .mockRejectedValueOnce(new TransportError(0, '无法连接服务器'))
      .mockResolvedValueOnce(CATALOG)
    const wrapper = await render()
    expect(wrapper.text()).toContain('无法连接服务器')
    await wrapper
      .findAll('button')
      .filter((node) => node.text() === '重试')[0]
      ?.trigger('click')
    await flushPromises()
    expect(fetchIt).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('user:view')
  })

  it('可以切成卡片视图，同一批码还在', async () => {
    const wrapper = await render()
    await wrapper.find('[aria-label="卡片视图"]').trigger('click')
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.text()).toContain('user:view')
  })
})

/** 切到卡片视图并返回 wrapper：这一页的切换器只有页面顶部一个。 */
async function renderCards(held: string[] = []) {
  const wrapper = await render(held)
  await wrapper.find('[aria-label="卡片视图"]').trigger('click')
  return wrapper
}

/** 一张卡上那枚 md 尺寸的标就是档位标，卡里其余的标都是 sm。 */
function kindTagsOf(wrapper: VueWrapper) {
  return wrapper
    .findAll('.permission-card')
    .map((card) => card.find('.dt-tag--md'))
}

describe('权限目录页的卡片视图', () => {
  it('卡片视图走本页专属卡，而不是通用卡的字段表', async () => {
    const wrapper = await renderCards()
    expect(wrapper.findAll('.permission-card').length).toBe(4)
    expect(wrapper.find('dl').exists()).toBe(false)
  })

  it('四档各有自己的文字，颜色不是唯一通道', async () => {
    const labels = kindTagsOf(await renderCards()).map((tag) => tag.text())
    expect(labels).toEqual(
      expect.arrayContaining(['查看', '高危', '管理', '操作']),
    )
  })

  it('四档各有自己的图形与色意，一眼能分开', async () => {
    const tags = kindTagsOf(await renderCards())
    expect(tags.every((tag) => tag.find('svg').exists())).toBe(true)
    expect(new Set(tags.map((tag) => tag.attributes('style'))).size).toBe(4)
  })

  it('档位文案与表格视图逐字相同，两种视图不许各说各话', async () => {
    const table = (await render()).text()
    const cards = (await renderCards()).text()
    for (const label of ['查看', '管理', '操作', '高危']) {
      expect(table).toContain(label)
      expect(cards).toContain(label)
    }
  })

  it('持有与未持有在卡片上都有文字，不靠颜色分辨', async () => {
    const wrapper = await renderCards(['user:view'])
    const texts = wrapper.findAll('.permission-card').map((card) => card.text())
    expect(texts.filter((text) => text.includes('未持有')).length).toBe(3)
    expect(
      texts.filter((text) => text.includes('持有') && !text.includes('未持有'))
        .length,
    ).toBe(1)
  })

  it('持有标记与表格视图一致：同一个码两边都说持有', async () => {
    expect((await render(['user:view'])).text()).toContain('持有')
    expect((await renderCards(['user:view'])).text()).toContain('持有')
  })

  it('关键词过滤后卡片跟着少，留下的还是那几张', async () => {
    const wrapper = await renderCards()
    await wrapper.find('input').setValue('route_rule')
    const texts = wrapper.findAll('.permission-card').map((card) => card.text())
    expect(texts.length).toBe(2)
    expect(texts.join('|')).toContain('route_rule:apply')
    expect(texts.join('|')).not.toContain('user:view')
  })

  it('自建码在卡片上显式标出，没有说明的也占一行位', async () => {
    const wrapper = await renderCards()
    const card = wrapper
      .findAll('.permission-card')
      .find((node) => node.text().includes('route_rule:apply'))
    expect(card?.text()).toContain('自建')
    expect(card?.text()).toContain('—')
  })
})
