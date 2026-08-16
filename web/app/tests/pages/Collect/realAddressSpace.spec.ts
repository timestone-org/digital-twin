/**
 * @fileoverview 拿现场那台 KEPServerEX 的真实地址空间跑一遍勾选。
 *
 * ⚠ 手编的夹具编不出「声称有子节点、浏览回来却是空的对象节点」这种形状，而
 * 它正是现场「有些能勾、有些勾了没反应」的来源：驱动把 `has_children` 定成
 * 「不是变量就是有子节点」，于是每个空文件夹也长出一个勾选框。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import type { CollectSource } from '@dt/contracts'

import * as collectApi from '@/api/collect'
import BrowsePanel from '@/pages/Collect/Opcua/components/BrowsePanel.vue'
import { useAuthStore } from '@/stores/auth'
import { REAL_TREE, ROOT, walkFixture } from '@/testing/collectAddressSpace'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/collect/opcua/s1/browse', query: {} }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
const toastWarning = vi.fn()
const toastInfo = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useConfirm: () => ({ ask: vi.fn().mockResolvedValue(true) }),
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: toastInfo,
      warning: toastWarning,
    }),
  }
})

function source(): CollectSource {
  return {
    id: 's1',
    name: '保定SCADA',
    code: 'scada_opcua',
    description: null,
    protocol: 'opcua',
    endpoint: 'opc.tcp://192.168.1.11:49320',
    username: null,
    has_credential: false,
    options_json: {},
    read_mode: 'subscribe',
    poll_interval_ms: 1000,
    is_enabled: true,
    point_count: 0,
    live_point_limit: 1000,
    runtime: {
      state: 'online',
      point_count: 0,
      error_category: null,
      error_detail: null,
      leader_instance: 'c1',
      updated_at: null,
    },
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}

function signIn(): void {
  const codes = ['collect:view', 'collect:operate', 'collect:manage']
  const auth = useAuthStore()
  auth.user = {
    username: 'admin',
    role: { name: 'admin' },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  } as never
  auth.accessToken = 'token'
}

async function render(): Promise<VueWrapper> {
  vi.spyOn(collectApi, 'browseSource').mockImplementation(
    (_sourceId: string, parent: string | null) =>
      Promise.resolve({ items: REAL_TREE[parent ?? ROOT] ?? [] }),
  )
  vi.spyOn(collectApi, 'browseSubtree').mockImplementation(
    (_sourceId: string, parent: string | null) =>
      Promise.resolve(walkFixture(REAL_TREE, parent)),
  )
  vi.spyOn(collectApi, 'listPoints').mockResolvedValue({
    items: [],
    page: 1,
    size: 100,
    total: 0,
  })
  const wrapper = mount(BrowsePanel, { props: { source: source() } })
  await flushPromises()
  return wrapper
}

/** 把树上所有还能展开的节点都展开，直到没有折叠的箭头。 */
async function expandAll(wrapper: VueWrapper): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    const closed = wrapper.findAll('button[aria-label="展开"]')
    if (closed.length === 0) return
    for (const one of closed) {
      await one.trigger('click')
      await flushPromises()
    }
  }
}

function boxes(wrapper: VueWrapper): DOMWrapper<Element>[] {
  return wrapper.findAll('label.dt-checkbox').map((one) => one.find('input'))
}

/** 变量的框有可见 label；上层节点的框只有 aria-label。 */
function isVariableBox(target: DOMWrapper<Element>): boolean {
  return target.attributes('aria-label') === undefined
}

function findByAria(
  wrapper: VueWrapper,
  aria: string,
): DOMWrapper<Element> | undefined {
  return wrapper
    .findAll('label.dt-checkbox')
    .map((one) => one.find('input'))
    .find((one) => one.attributes('aria-label') === aria)
}

function boxByAria(wrapper: VueWrapper, aria: string): DOMWrapper<Element> {
  const found = findByAria(wrapper, aria)
  if (found === undefined) throw new Error(`找不到 aria=${aria} 的勾选框`)
  return found
}

/**
 * 一层层展开，直到目标节点**露出来**就停。
 * ⚠ 不能用 expandAll：展开目标自己会把「声称有子节点其实没有」就地纠正掉，
 * 而那正是这几条用例要复现的东西。
 */
async function openUntil(
  wrapper: VueWrapper,
  aria: string,
): Promise<DOMWrapper<Element>> {
  for (let round = 0; round < 8; round += 1) {
    const found = findByAria(wrapper, aria)
    if (found !== undefined) return found
    const closed = wrapper.findAll('button[aria-label="展开"]')
    if (closed.length === 0) break
    for (const one of closed) {
      await one.trigger('click')
      await flushPromises()
    }
  }
  throw new Error(`展不出 aria=${aria} 的勾选框`)
}

enableAutoUnmount(afterEach)

beforeEach(() => {
  setActivePinia(createPinia())
  toastError.mockReset()
  toastSuccess.mockReset()
  toastWarning.mockReset()
  toastInfo.mockReset()
  signIn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('真实地址空间', () => {
  it('展得开，且树上确实既有变量也有对象节点', async () => {
    const wrapper = await render()
    await expandAll(wrapper)
    const all = boxes(wrapper)

    expect(all.filter(isVariableBox).length).toBeGreaterThan(10)
    expect(all.filter((one) => !isVariableBox(one)).length).toBeGreaterThan(3)
  })

  it('⚠ 每一个变量都勾得上——一个勾不上就是现场那个「有些不行」', async () => {
    const wrapper = await render()
    await expandAll(wrapper)
    const stuck: string[] = []

    for (const target of boxes(wrapper).filter(isVariableBox)) {
      await target.setValue(true)
      await flushPromises()
      if (!(target.element as HTMLInputElement).checked) {
        stuck.push(target.attributes('id') ?? '?')
      }
    }

    expect(stuck).toEqual([])
  })

  it('⚠ 空对象节点勾了之后不许留下一个「看起来勾上了」的框', async () => {
    // `i=2295`（VendorServerInfo）声称有子节点，浏览回来却是空的
    const wrapper = await render()
    const target = await openUntil(wrapper, '全选「VendorServerInfo」下的点位')

    await target.setValue(true)
    await flushPromises()

    expect((target.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).not.toContain('已选')
  })

  it('⚠ 勾了没选上任何点位时要说出来，不许一声不吭', async () => {
    const wrapper = await render()
    const target = await openUntil(wrapper, '全选「VendorServerInfo」下的点位')

    await target.setValue(true)
    await flushPromises()

    expect(toastInfo).toHaveBeenCalledTimes(1)
    expect(toastInfo.mock.calls[0]?.[0]).toContain('没有')
  })

  it('⚠ 展开过一次之后，空节点连勾选框都不该留着', async () => {
    const wrapper = await render()
    await expandAll(wrapper)

    const empty = wrapper
      .findAll('label.dt-checkbox')
      .map((one) => one.find('input'))
      .find(
        (one) =>
          one.attributes('aria-label') === '全选「VendorServerInfo」下的点位',
      )

    expect(empty).toBeUndefined()
  })

  it('⚠ 勾一个上层节点只打一次接口，不是一层一趟', async () => {
    const wrapper = await render()
    const browse = vi.mocked(collectApi.browseSource)
    const afterRoot = browse.mock.calls.length

    await boxByAria(wrapper, '全选「Server」下的点位').setValue(true)
    await flushPromises()

    expect(vi.mocked(collectApi.browseSubtree)).toHaveBeenCalledTimes(1)
    expect(browse.mock.calls.length).toBe(afterRoot)
  })

  it('有变量的对象节点照常整棵勾上', async () => {
    const wrapper = await render()
    await expandAll(wrapper)

    await boxByAria(wrapper, '全选「ServerCapabilities」下的点位').setValue(
      true,
    )
    await flushPromises()

    expect(wrapper.text()).toContain('已选')
  })
})
