/**
 * @fileoverview 地址空间树的挂载行为：展开、逐个勾选、按子树批量勾选、建点。
 *
 * ⚠ 这一层缺过一次：只测了 `browseTree.ts` 的纯逻辑，没有任何用例真的**挂过**
 * 这棵树——纯逻辑测试看不见渲染期抛出的异常。
 * ⚠ 勾选框一律按名字定位，不按下标：上层节点也有框之后，`find('input')` 拿到
 * 的是谁全看渲染顺序，用例会因为点错了框而**蒙对**。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { ROOT, walkFixture } from '@/testing/collectAddressSpace'
import type {
  CollectBrowseItem,
  CollectPoint,
  CollectSource,
} from '@dt/contracts'

import * as collectApi from '@/api/collect'
import BrowsePanel from '@/pages/Collect/Opcua/components/BrowsePanel.vue'
import BrowseTreeNode from '@/pages/Collect/Opcua/components/BrowseTreeNode.vue'
import { useAuthStore } from '@/stores/auth'

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
    name: '一号车间 PLC',
    code: 'plant1',
    protocol: 'opcua',
    description: null,
    endpoint: 'opc.tcp://10.0.0.2:4840',
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

/** 一个变量节点。 */
function leaf(name: string): CollectBrowseItem {
  return {
    address: `ns=2;s=${name}`,
    name,
    has_children: false,
    is_variable: true,
  }
}

/** 一个还能往下走的对象节点。 */
function branch(name: string): CollectBrowseItem {
  return {
    address: `ns=2;s=${name}`,
    name,
    has_children: true,
    is_variable: false,
  }
}

function point(address: string, code: string): CollectPoint {
  return {
    id: code,
    source_id: 's1',
    node_key: `s1:${code}`,
    code,
    name: code,
    address,
    data_type: 'float',
    unit: null,
    sampling_interval_ms: 1000,
    deadband: 0,
    archive_enabled: true,
    archive_max_interval_ms: 60_000,
    archive_retention_days: null,
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

/**
 * 按「父寻址串 → 子层」装一棵可懒加载的树。
 * ⚠ 用真实的按 parent 分派而不是每次回同一批：只回同一批的话，「补拉了没有」
 * 这条断言永远成立，等于没测。
 */
function browseTree(
  tree: Record<string, CollectBrowseItem[]>,
  maxNodes: number,
): void {
  vi.spyOn(collectApi, 'browseSource').mockImplementation(
    (_sourceId: string, parent: string | null) =>
      Promise.resolve({ items: tree[parent ?? ROOT] ?? [] }),
  )
  vi.spyOn(collectApi, 'browseSubtree').mockImplementation(
    (_sourceId: string, parent: string | null) =>
      Promise.resolve(walkFixture(tree, parent, maxNodes)),
  )
}

async function render(
  tree: Record<string, CollectBrowseItem[]>,
  existing: CollectPoint[] = [],
  maxNodes = 500,
): Promise<VueWrapper> {
  browseTree(tree, maxNodes)
  vi.spyOn(collectApi, 'listPoints').mockResolvedValue({
    items: existing,
    page: 1,
    size: 100,
    total: existing.length,
  })
  const wrapper = mount(BrowsePanel, { props: { source: source() } })
  await flushPromises()
  return wrapper
}

/** 按节点名字取它的勾选框：变量看 label 文本，上层看 aria-label。 */
function box(wrapper: VueWrapper, name: string): DOMWrapper<Element> {
  const found = wrapper.findAll('label.dt-checkbox').find((one) => {
    const aria = one.find('input').attributes('aria-label')
    return one.text() === name || aria === `全选「${name}」下的点位`
  })
  if (found === undefined) throw new Error(`找不到「${name}」的勾选框`)
  return found.find('input')
}

function hasBox(wrapper: VueWrapper, name: string): boolean {
  try {
    box(wrapper, name)
    return true
  } catch {
    return false
  }
}

function element(wrapper: VueWrapper, name: string): HTMLInputElement {
  return box(wrapper, name).element as HTMLInputElement
}

/** 树上的展开箭头。⚠ 按 aria-label 找，别撞上工具条的「重新浏览」。 */
function chevron(wrapper: VueWrapper, index = 0): DOMWrapper<Element> {
  const found = wrapper.findAll(
    'button[aria-label="展开"], button[aria-label="收起"]',
  )[index]
  if (found === undefined) throw new Error(`没有第 ${index} 个展开箭头`)
  return found
}

async function click(target: DOMWrapper<Element>): Promise<void> {
  await target.trigger('click')
  await flushPromises()
}

async function check(target: DOMWrapper<Element>): Promise<void> {
  await target.setValue(true)
  await flushPromises()
}

async function uncheck(target: DOMWrapper<Element>): Promise<void> {
  await target.setValue(false)
  await flushPromises()
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

describe('浏览', () => {
  it('列出根一层的节点', async () => {
    const wrapper = await render({ [ROOT]: [leaf('Temp')] })
    expect(wrapper.text()).toContain('ns=2;s=Temp')
  })

  it('展开一个对象节点只问它这一层', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [leaf('Temp')],
    })

    await click(chevron(wrapper))

    expect(wrapper.text()).toContain('ns=2;s=Temp')
    expect(vi.mocked(collectApi.browseSource)).toHaveBeenLastCalledWith(
      's1',
      'ns=2;s=Line1',
    )
  })

  it('⚠ 收起再展开不再打一趟设备——地址空间浏览是实打实的设备负载', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [leaf('Temp')],
    })
    const browse = vi.mocked(collectApi.browseSource)

    await click(chevron(wrapper))
    const afterOpen = browse.mock.calls.length
    await click(chevron(wrapper))
    await click(chevron(wrapper))

    expect(browse.mock.calls.length).toBe(afterOpen)
    expect(wrapper.text()).toContain('ns=2;s=Temp')
  })
})

describe('逐个勾选', () => {
  it('勾一个变量只勾它自己', async () => {
    const wrapper = await render({ [ROOT]: [leaf('Temp'), leaf('Flow')] })

    await check(box(wrapper, 'Temp'))

    expect(wrapper.text()).toContain('已选 1')
    expect(element(wrapper, 'Flow').checked).toBe(false)
  })

  it('再勾一次取消选中', async () => {
    const wrapper = await render({ [ROOT]: [leaf('Temp')] })

    await check(box(wrapper, 'Temp'))
    await uncheck(box(wrapper, 'Temp'))

    expect(wrapper.text()).not.toContain('已选')
  })

  it('已经建过点位的变量勾不动', async () => {
    const wrapper = await render({ [ROOT]: [leaf('Temp')] }, [
      point('ns=2;s=Temp', 'temp'),
    ])

    expect(element(wrapper, 'Temp').disabled).toBe(true)
    expect(wrapper.text()).toContain('已建')
  })
})

describe('按子树批量勾选', () => {
  it('上层节点也有勾选框', async () => {
    const wrapper = await render({ [ROOT]: [branch('Line1')] })
    expect(hasBox(wrapper, 'Line1')).toBe(true)
  })

  it('勾上层把它下面已加载的变量全勾上', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [leaf('Temp'), leaf('Flow')],
    })
    await click(chevron(wrapper))

    await check(box(wrapper, 'Line1'))

    expect(wrapper.text()).toContain('已选 2')
    expect(element(wrapper, 'Temp').checked).toBe(true)
    expect(element(wrapper, 'Flow').checked).toBe(true)
  })

  it('⚠ 没展开过也能勾——整棵子树由采集侧一次收齐', async () => {
    // ⚠ 这里守的是「一次请求」：逐层补拉的老做法在这棵三层的树上要打三趟，
    // 真实通道上就是几百趟串行请求，而现场只看到界面卡住
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [branch('Zone'), leaf('Temp')],
      'ns=2;s=Zone': [leaf('Deep')],
    })
    const browse = vi.mocked(collectApi.browseSource)
    const afterRoot = browse.mock.calls.length

    await check(box(wrapper, 'Line1'))

    expect(wrapper.text()).toContain('已选 2')
    expect(vi.mocked(collectApi.browseSubtree)).toHaveBeenCalledExactlyOnceWith(
      's1',
      'ns=2;s=Line1',
    )
    expect(browse.mock.calls.length).toBe(afterRoot)
  })

  it('⚠ 收齐之后层级还在，不是一张平铺的清单', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [branch('Zone')],
      'ns=2;s=Zone': [leaf('Deep')],
    })

    await check(box(wrapper, 'Line1'))
    // 勾完只展开一层：深处的节点在数据里，但要点开才看得见
    expect(wrapper.text()).toContain('ns=2;s=Zone')
    expect(wrapper.text()).not.toContain('ns=2;s=Deep')

    await click(chevron(wrapper, 1))

    expect(wrapper.text()).toContain('ns=2;s=Deep')
    expect(element(wrapper, 'Deep').checked).toBe(true)
  })

  it('⚠ 已经全在手上时不再打设备——逐层展开过的那些再问一遍是白跑', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [leaf('Temp')],
    })
    await click(chevron(wrapper))

    await check(box(wrapper, 'Line1'))

    expect(vi.mocked(collectApi.browseSubtree)).not.toHaveBeenCalled()
  })

  it('已经全勾上时再点是取消，且不再打设备', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [leaf('Temp')],
    })
    await check(box(wrapper, 'Line1'))
    const browse = vi.mocked(collectApi.browseSource)
    const afterPick = browse.mock.calls.length

    await uncheck(box(wrapper, 'Line1'))

    expect(wrapper.text()).not.toContain('已选')
    expect(browse.mock.calls.length).toBe(afterPick)
  })

  it('⚠ 只勾了一部分时上层是半选，不是全选', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [leaf('Temp'), leaf('Flow')],
    })
    await click(chevron(wrapper))

    await check(box(wrapper, 'Temp'))

    expect(element(wrapper, 'Line1').indeterminate).toBe(true)
    expect(element(wrapper, 'Line1').checked).toBe(false)
  })

  it('⚠ 下面还有没拉过的层时也只算半选——全选等于替用户担保他没看过的那些', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Line1')],
      'ns=2;s=Line1': [leaf('Temp'), branch('Zone')],
      'ns=2;s=Zone': [leaf('Deep')],
    })
    await click(chevron(wrapper))

    await check(box(wrapper, 'Temp'))

    expect(element(wrapper, 'Line1').indeterminate).toBe(true)
  })

  it('批量勾选跳过已经建过点位的变量', async () => {
    const wrapper = await render(
      {
        [ROOT]: [branch('Line1')],
        'ns=2;s=Line1': [leaf('Temp'), leaf('Flow')],
      },
      [point('ns=2;s=Temp', 'temp')],
    )

    await check(box(wrapper, 'Line1'))

    expect(wrapper.text()).toContain('已选 1')
    expect(element(wrapper, 'Flow').checked).toBe(true)
  })

  it('⚠ 采集侧没走完时要说出来，不静默只勾一半', async () => {
    // 唯一的刹车是这次请求的时间：模拟它到点，界面必须转达
    const deep: Record<string, CollectBrowseItem[]> = { [ROOT]: [branch('n0')] }
    for (let index = 0; index < 10; index += 1) {
      deep[`ns=2;s=n${index}`] = [branch(`n${index + 1}`), leaf(`v${index}`)]
    }
    const wrapper = await render(deep, [], 3)

    await check(box(wrapper, 'n0'))

    expect(toastWarning).toHaveBeenCalledTimes(1)
    expect(toastWarning.mock.calls[0]?.[0]).toContain('没走完')
  })

  it('⚠ 勾了一个空节点要说出来，不许一声不吭', async () => {
    // 驱动把「不是变量」一律当成「有子节点」，空文件夹因此也长着一个勾选框
    const wrapper = await render({
      [ROOT]: [branch('Empty')],
      'ns=2;s=Empty': [],
    })

    await check(box(wrapper, 'Empty'))

    expect(toastInfo).toHaveBeenCalledTimes(1)
    expect(toastInfo.mock.calls[0]?.[0]).toContain('没有可选的点位')
    expect(wrapper.text()).not.toContain('已选')
  })

  it('⚠ 下面的点位全建过了也要说出来', async () => {
    const wrapper = await render(
      {
        [ROOT]: [branch('Line1')],
        'ns=2;s=Line1': [leaf('Temp')],
      },
      [point('ns=2;s=Temp', 'temp')],
    )

    await check(box(wrapper, 'Line1'))

    expect(toastInfo).toHaveBeenCalledTimes(1)
    expect(toastInfo.mock.calls[0]?.[0]).toContain('都已经建过了')
  })

  it('⚠ 空节点收齐之后连勾选框都不该留着', async () => {
    const wrapper = await render({
      [ROOT]: [branch('Empty')],
      'ns=2;s=Empty': [],
    })

    await click(chevron(wrapper))

    expect(hasBox(wrapper, 'Empty')).toBe(false)
  })
})

describe('导入选中', () => {
  it('先开导入弹窗统一设采样与归档默认，确认后寻址串原样带过去', async () => {
    const wrapper = await render({ [ROOT]: [leaf('Temp'), leaf('Flow')] })
    const create = vi.spyOn(collectApi, 'createPoints').mockResolvedValue({
      items: [],
      address_checks: [],
    })

    await check(box(wrapper, 'Temp'))
    await check(box(wrapper, 'Flow'))
    const open = wrapper
      .findAll('button')
      .find((one) => one.text().startsWith('导入选中'))
    if (open === undefined) throw new Error('没有「导入选中」按钮')
    await click(open)

    // 弹窗 teleport 在 body 上，wrapper.findAll 看不见它
    const confirm = [...document.body.querySelectorAll('button')].find((one) =>
      /^导入 \d+ 个节点$/.test(one.textContent?.trim() ?? ''),
    )
    if (confirm === undefined) throw new Error('弹窗里没有「导入」按钮')
    confirm.click()
    await flushPromises()

    expect(create).toHaveBeenCalledTimes(1)
    const items = create.mock.calls[0]?.[0]?.items ?? []
    expect(items.map((one) => one.address)).toEqual([
      'ns=2;s=Temp',
      'ns=2;s=Flow',
    ])
    // 弹窗里的统一默认（采样间隔 / 记录历史）套到了每一项上
    expect(items.every((one) => one.sampling_interval_ms === 1000)).toBe(true)
    expect(items.every((one) => one.archive_enabled === true)).toBe(true)
  })
})

/**
 * ⚠ 这一组守的是「树的规模」：现场一个通道就有几万个点位，而采集侧刻意不设条数
 * 上限（`subtree.py`），所以这棵树在几万个节点上必须还能用。
 */
describe('几万点位的文件夹', () => {
  it('⚠ 勾一下不许换掉那张勾选态表：换一张就是让树上每个节点都重渲染一遍', async () => {
    const wrapper = await render({ [ROOT]: [leaf('Temp'), leaf('Flow')] })
    const first = wrapper.findComponent(BrowseTreeNode)
    const before: unknown = first.props('states')

    await check(box(wrapper, 'Temp'))

    expect(first.props('states')).toBe(before)
    // 身份没换，但内容确实更新了——不然「不换」只是因为它压根没算
    expect(element(wrapper, 'Temp').checked).toBe(true)
  })
})
