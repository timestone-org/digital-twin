/**
 * @fileoverview 契约：分享弹窗自己发布 / 撤回，链接形状是
 * `<origin>/public/<token>`，重新发布与撤回都要先过二次确认——「再点一次发布」
 * 不是幂等的，它会把已经发出去的链接全废掉。
 *
 * ⚠ 当前链接必须从**发布面**取（`getDashboardPublication`）：大屏详情不带
 * 令牌，从那里读永远是 null，而这件事在打桩的用例里看不出来——桩比真实现宽。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { DtToastHost, useConfirm } from '@dt/ui'
import type { DashboardPublication } from '@dt/contracts'

import * as shareApi from '@/api/dashboardShare'
import * as clipboard from '@/utils/clipboard'
import type { DashboardSummary } from '@/api/dashboardWire'
import ShareDashboardDialog from '@/pages/Home/components/ShareDashboardDialog.vue'

function summary(isPublic: boolean): DashboardSummary {
  return {
    id: 'd1',
    projectId: 'p1',
    name: '光伏总览',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 1,
    schemaVersion: 1,
    isPublic,
    nodeCount: 4,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

function mountDialog(isPublic: boolean) {
  return mount(ShareDashboardDialog, {
    props: { open: true, dashboard: summary(isPublic) },
    global: { stubs: { Teleport: true } },
  })
}

async function clickText(
  wrapper: ReturnType<typeof mountDialog>,
  label: string,
): Promise<void> {
  const hit = wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))
  expect(hit, `没有文案含「${label}」的按钮`).toBeDefined()
  await hit?.trigger('click')
}

beforeEach(() => {
  vi.spyOn(shareApi, 'publishDashboard').mockResolvedValue({
    dashboardId: 'd1',
    isPublic: true,
    publicToken: 'tok-new',
  })
  vi.spyOn(shareApi, 'unpublishDashboard').mockResolvedValue({
    dashboardId: 'd1',
    isPublic: false,
    publicToken: null,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useConfirm().resolve(false)
})

describe('未公开', () => {
  it('说清发布后是匿名可读，并且随时能撤回', () => {
    const wrapper = mountDialog(false)

    expect(wrapper.text()).toContain('还没有公开')
    expect(wrapper.text()).toContain('匿名可读')
  })

  it('首次发布不拦二次确认，成功后把链接摆出来并 emit updated', async () => {
    const wrapper = mountDialog(false)

    await clickText(wrapper, '发布并生成链接')
    await flushPromises()

    expect(shareApi.publishDashboard).toHaveBeenCalledWith('d1')
    expect(wrapper.emitted('updated')).toEqual([
      [{ dashboardId: 'd1', isPublic: true, publicToken: 'tok-new' }],
    ])
    expect(wrapper.find('input').element.value).toBe(
      `${location.origin}/public/tok-new`,
    )
  })

  it('发布失败时不切成已公开态', async () => {
    vi.spyOn(shareApi, 'publishDashboard').mockRejectedValue(new Error('炸了'))
    const wrapper = mountDialog(false)

    await clickText(wrapper, '发布并生成链接')
    await flushPromises()

    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.text()).toContain('还没有公开')
  })
})

describe('已公开', () => {
  beforeEach(() => {
    vi.spyOn(shareApi, 'getDashboardPublication').mockResolvedValue({
      dashboardId: 'd1',
      isPublic: true,
      publicToken: 'tok-old',
    })
  })

  it('打开时向发布面要一次当前链接，并把它显示出来', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.find('input').element.value).toBe(
      `${location.origin}/public/tok-old`,
    )
  })

  it('界面上写清「重新发布会让旧链接立即失效」', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.text()).toContain('每次发布都会换一个新令牌')
    expect(wrapper.text()).toContain('之前发出去的链接会立即失效')
  })

  it('重新发布先问一遍，答不换就一个请求都不发', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '重新发布')
    useConfirm().resolve(false)
    await flushPromises()

    expect(shareApi.publishDashboard).not.toHaveBeenCalled()
  })

  it('答应换新之后才发布，并换成新令牌', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '重新发布')
    useConfirm().resolve(true)
    await flushPromises()

    expect(shareApi.publishDashboard).toHaveBeenCalledWith('d1')
    expect(wrapper.find('input').element.value).toBe(
      `${location.origin}/public/tok-new`,
    )
  })

  it('撤回也先问一遍，答应后切回未公开态并 emit updated', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '撤回公开')
    useConfirm().resolve(true)
    await flushPromises()

    expect(shareApi.unpublishDashboard).toHaveBeenCalledWith('d1')
    expect(wrapper.emitted('updated')).toEqual([
      [{ dashboardId: 'd1', isPublic: false, publicToken: null }],
    ])
    expect(wrapper.text()).toContain('还没有公开')
  })
})

describe('问确认的过程中弹窗被关掉', () => {
  beforeEach(() => {
    vi.spyOn(shareApi, 'getDashboardPublication').mockResolvedValue({
      dashboardId: 'd1',
      isPublic: true,
      publicToken: 'tok-old',
    })
  })

  it('答「确定」也不发布——旧链接不该在人已经离开这个面之后被换掉', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '重新发布')
    await wrapper.setProps({ open: false, dashboard: null })
    useConfirm().resolve(true)
    await flushPromises()

    expect(shareApi.publishDashboard).not.toHaveBeenCalled()
  })

  it('撤回同理：弹窗已经不在了，就不许悄悄把链接关掉', async () => {
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '撤回公开')
    await wrapper.setProps({ open: false, dashboard: null })
    useConfirm().resolve(true)
    await flushPromises()

    expect(shareApi.unpublishDashboard).not.toHaveBeenCalled()
  })
})

describe('取当前链接与发布抢着写', () => {
  it('慢的那次读回来，不许把刚换发的新令牌盖回旧的', async () => {
    // ⚠ 这是「重新发布之后链接又变回旧的」的成因：读是打开弹窗就发的，
    // 发布是后按的，先发的那条后回来，落地的就是换发**之前**那一个
    let settle: (publication: DashboardPublication) => void = () => undefined
    vi.spyOn(shareApi, 'getDashboardPublication').mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    const wrapper = mountDialog(true)

    await clickText(wrapper, '重新发布')
    useConfirm().resolve(true)
    await flushPromises()
    settle({ dashboardId: 'd1', isPublic: true, publicToken: 'tok-old' })
    await flushPromises()

    expect(wrapper.find('input').element.value).toBe(
      `${location.origin}/public/tok-new`,
    )
  })

  it('读不出当前链接时说出来，而不是一直挂着「正在取」', async () => {
    vi.spyOn(shareApi, 'getDashboardPublication').mockRejectedValue(
      new Error('炸了'),
    )
    const wrapper = mountDialog(true)
    await flushPromises()

    expect(wrapper.text()).not.toContain('正在取')
    expect(wrapper.text()).toContain('取不到这张屏当前的公开链接')
  })
})

describe('复制链接', () => {
  beforeEach(() => {
    vi.spyOn(shareApi, 'getDashboardPublication').mockResolvedValue({
      dashboardId: 'd1',
      isPublic: true,
      publicToken: 'tok-old',
    })
  })

  it('走 copyText——现场是纯 HTTP，navigator.clipboard 在那里不存在', async () => {
    const copy = vi.spyOn(clipboard, 'copyText').mockResolvedValue(true)
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '复制链接')

    expect(copy).toHaveBeenCalledWith(`${location.origin}/public/tok-old`)
  })

  it('复制失败时告诉人手动选中，而不是假装成功', async () => {
    vi.spyOn(clipboard, 'copyText').mockResolvedValue(false)
    mount(DtToastHost)
    const wrapper = mountDialog(true)
    await flushPromises()

    await clickText(wrapper, '复制链接')
    await flushPromises()

    expect(document.body.textContent).toContain('请手动选中')
  })
})
