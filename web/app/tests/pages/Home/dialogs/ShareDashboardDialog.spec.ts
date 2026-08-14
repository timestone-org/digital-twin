/**
 * @fileoverview 契约：分享弹窗自己发布 / 撤回，链接形状是
 * `<origin>/public/<token>`，重新发布与撤回都要先过二次确认——「再点一次发布」
 * 不是幂等的，它会把已经发出去的链接全废掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { useConfirm } from '@dt/ui'

import * as dashboardApi from '@/api/dashboard'
import * as shareApi from '@/api/dashboardShare'
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
    id: 'd1',
    isPublic: true,
    publicToken: 'tok-new',
  })
  vi.spyOn(shareApi, 'unpublishDashboard').mockResolvedValue({
    id: 'd1',
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
      [{ id: 'd1', isPublic: true, publicToken: 'tok-new' }],
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
    vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue({
      id: 'd1',
      projectId: 'p1',
      name: '光伏总览',
      description: null,
      designWidth: 1920,
      designHeight: 1080,
      themeJson: {},
      chromeJson: {},
      rowVersion: 1,
      schemaVersion: 1,
      isPublic: true,
      publicToken: 'tok-old',
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
      nodes: [],
    })
  })

  it('打开时补一次详情，把当前那条链接显示出来', async () => {
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
      [{ id: 'd1', isPublic: false, publicToken: null }],
    ])
    expect(wrapper.text()).toContain('还没有公开')
  })
})
