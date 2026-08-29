/**
 * @fileoverview 卡片样式库页的行为契约。
 *
 * ⚠ 最要紧的两条：存下去的内芯必须是**整套观感键**（套用是浅合并，少一个键就会
 * 让上一套的那个取值原样残留，而屏上看不出少了什么）；内置条目点开是**新建**
 * 而不是改（带着内置的 id 去 PATCH 会打到一个并不存在的样式上）。
 */
import type { CardStyle } from '@dt/contracts'
import type { CardStyleInput } from '@/api/cardStyles'
import { DtConfirmHost, DtToastHost, useConfirm } from '@dt/ui'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import CardStyleFields from '@/components/chrome/CardStyleFields.vue'
import CardStylesPage from '@/pages/CardStyles/index.vue'
import { useAuthStore } from '@/stores/auth'

// ⚠ 桩逐个标类型：不标的话调用记录是 `any`，断言里摸 `.config` 会被
//   no-unsafe-member-access 拦下，而且写错字段名也没人拦
const api = vi.hoisted(() => ({
  listCardStyles: vi.fn<() => Promise<unknown>>(),
  getCardStyle: vi.fn<() => Promise<CardStyle>>(),
  createCardStyle: vi.fn<(input: CardStyleInput) => Promise<CardStyle>>(),
  updateCardStyle:
    vi.fn<(id: string, input: CardStyleInput) => Promise<CardStyle>>(),
  deleteCardStyle: vi.fn<(id: string) => Promise<void>>(),
  CARD_STYLE_NOT_FOUND_CODE: 41016,
}))

vi.mock('@/api/cardStyles', () => api)

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/card-styles', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

enableAutoUnmount(afterEach)

function style(over: Partial<CardStyle> = {}): CardStyle {
  return {
    id: 'a1',
    name: '蓝调科技卡',
    description: '呼吸描边',
    moduleType: 'info-card',
    chrome: { radius: 4 },
    config: { align: 'left' },
    thumbnail: null,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...over,
  }
}

function mountPage(): ReturnType<typeof mount> {
  return mount(
    {
      components: { CardStylesPage, DtToastHost, DtConfirmHost },
      template: '<div><CardStylesPage /><DtToastHost /><DtConfirmHost /></div>',
    },
    { attachTo: document.body },
  )
}

beforeEach(() => {
  // ⚠ 桩是 hoisted 的、跨用例活着：不清的话 `toHaveBeenCalled` 断言读到的是上一条
  //   用例留下的调用记录，红绿与本条用例毫无关系
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const codes = ['dashboard:view', 'dashboard:manage']
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'heyufan',
    permissions: codes,
    role_permissions: codes,
  } as never
  auth.accessToken = 'token'
  api.listCardStyles.mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    size: 200,
  })
  api.createCardStyle.mockResolvedValue(style({ id: 'new-1' }))
  api.updateCardStyle.mockResolvedValue(style())
  api.deleteCardStyle.mockResolvedValue(undefined)
})

describe('卡片样式库', () => {
  it('进来就拉一次样式表', async () => {
    mountPage()
    await flushPromises()

    expect(api.listCardStyles).toHaveBeenCalledTimes(1)
  })

  // ⚠ 内置的不藏起来：藏了用户就得从零调四十个旋钮
  it('内置外壳风格与用户样式并排摆在左栏', async () => {
    api.listCardStyles.mockResolvedValue({
      items: [style()],
      total: 1,
      page: 1,
      size: 200,
    })
    const page = mountPage()
    await flushPromises()

    expect(page.find('[data-test="style-builtin:minimal"]').exists()).toBe(true)
    expect(page.find('[data-test="style-saved:a1"]').exists()).toBe(true)
  })

  it('选中一条用户样式后，保存打到改的那条上', async () => {
    api.listCardStyles.mockResolvedValue({
      items: [style()],
      total: 1,
      page: 1,
      size: 200,
    })
    const page = mountPage()
    await flushPromises()
    await page.find('[data-test="style-saved:a1"]').trigger('click')
    await page.find('[data-test="save-style"]').trigger('click')
    await flushPromises()

    expect(api.updateCardStyle).toHaveBeenCalledTimes(1)
    expect(api.createCardStyle).not.toHaveBeenCalled()
  })

  // ⚠ 带着内置条目的名字去 PATCH，会打到一个并不存在的样式上
  it('内置条目点开是新建：保存走 POST，名字带副本后缀', async () => {
    const page = mountPage()
    await flushPromises()
    await page.find('[data-test="style-builtin:minimal"]').trigger('click')
    await page.find('[data-test="save-style"]').trigger('click')
    await flushPromises()

    expect(api.updateCardStyle).not.toHaveBeenCalled()
    const [input] = api.createCardStyle.mock.calls[0] ?? []
    expect(String(input?.name)).toContain('副本')
    expect(input?.moduleType).toBeNull()
  })

  // ⚠ 这一条是整套东西最要紧的不变量
  it('存一条绑模块的样式时，内芯是补全过的整套观感键', async () => {
    api.listCardStyles.mockResolvedValue({
      items: [style({ config: { align: 'left' } })],
      total: 1,
      page: 1,
      size: 200,
    })
    const page = mountPage()
    await flushPromises()
    await page.find('[data-test="style-saved:a1"]').trigger('click')
    await page.find('[data-test="save-style"]').trigger('click')
    await flushPromises()

    const [, input] = api.updateCardStyle.mock.calls[0] ?? []
    const written = Object.keys(input?.config ?? {})
    expect(written.length).toBeGreaterThan(20)
    expect(written).toContain('align')
    // 内容键一个都不许混进去：套用时它会把用户配好的格整片抹掉
    expect(written).not.toContain('items')
    expect(written).not.toContain('title')
    expect(written).not.toContain('rules')
  })

  it('通用外壳样式存下去时内芯是空的', async () => {
    api.listCardStyles.mockResolvedValue({
      items: [style({ id: 'g1', moduleType: null, config: {} })],
      total: 1,
      page: 1,
      size: 200,
    })
    const page = mountPage()
    await flushPromises()
    await page.find('[data-test="style-saved:g1"]').trigger('click')
    await page.find('[data-test="save-style"]').trigger('click')
    await flushPromises()

    const [, input] = api.updateCardStyle.mock.calls[0] ?? []
    expect(input?.config).toEqual({})
  })

  it('名字空着时不发请求，只提示', async () => {
    const page = mountPage()
    await flushPromises()
    await page.find('[data-test="save-style"]').trigger('click')
    await flushPromises()

    expect(api.createCardStyle).not.toHaveBeenCalled()
  })

  // ⚠ 删除必须二次确认：它不做引用检查，删掉就没了
  it('删一条要先过确认框；点取消不发请求', async () => {
    api.listCardStyles.mockResolvedValue({
      items: [style()],
      total: 1,
      page: 1,
      size: 200,
    })
    const page = mountPage()
    await flushPromises()
    await page.find('[aria-label="删除样式"]').trigger('click')
    await flushPromises()

    expect(api.deleteCardStyle).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('删除样式')
  })

  it('确认之后才真的删', async () => {
    api.listCardStyles.mockResolvedValue({
      items: [style()],
      total: 1,
      page: 1,
      size: 200,
    })
    const page = mountPage()
    await flushPromises()
    await page.find('[aria-label="删除样式"]').trigger('click')
    useConfirm().resolve(true)
    await flushPromises()

    expect(api.deleteCardStyle).toHaveBeenCalledWith('a1')
  })

  // ⚠ 外壳整袋替换而不是逐键合并：合并会留残留，用户看到的是「换了样式没换干净」
  it('右栏改外壳后，存下去的是改过的那袋', async () => {
    api.listCardStyles.mockResolvedValue({
      items: [style()],
      total: 1,
      page: 1,
      size: 200,
    })
    const page = mountPage()
    await flushPromises()
    await page.find('[data-test="style-saved:a1"]').trigger('click')
    page
      .findComponent(CardStyleFields)
      .vm.$emit('update:modelValue', { radius: 12 })
    await flushPromises()
    await page.find('[data-test="save-style"]').trigger('click')
    await flushPromises()

    const [, input] = api.updateCardStyle.mock.calls[0] ?? []
    expect(input?.chrome).toEqual({ radius: 12 })
  })

  it('取数失败时把原因画出来，不是留一片空白', async () => {
    api.listCardStyles.mockRejectedValue(new Error('boom'))
    const page = mountPage()
    await flushPromises()

    expect(page.text()).toContain('请求失败')
  })
})
