/**
 * @fileoverview 契约：三合一新建大屏弹窗的 props 进得去、`submit` 抛出的
 * `NewDashboardPayload` 按起手方式带对字段，同名屏只提示不拦。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DtSelect } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { DashboardTemplateSummary, Page } from '@dt/contracts'

import * as templatesApi from '@/api/dashboardTemplates'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import NewDashboardDialog from '@/pages/Home/components/NewDashboardDialog.vue'

function project(id: string, name: string): ProjectSummary {
  return {
    id,
    name,
    description: null,
    themeJson: {},
    brandJson: {},
    dashboardCount: 1,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

function dashboard(id: string, name: string): DashboardSummary {
  return {
    id,
    projectId: 'p1',
    name,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    nodeCount: 3,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

function template(id: string, name: string): DashboardTemplateSummary {
  return {
    id,
    name,
    description: null,
    category: '能源',
    thumbnail: null,
    sourceProjectId: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

function templatePage(
  items: DashboardTemplateSummary[],
): Page<DashboardTemplateSummary> {
  return { items, total: items.length, page: 1, size: 100 }
}

function mountDialog(open: boolean) {
  return mount(NewDashboardDialog, {
    props: {
      open,
      projects: [project('p1', 'A 园区'), project('p2', 'B 园区')],
      currentProjectId: 'p1',
      dashboardsByProject: {
        p1: [dashboard('d1', '总览'), dashboard('d2', '能耗')],
      },
      presetTemplate: null,
      loading: false,
    },
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
  vi.spyOn(templatesApi, 'getDashboardTemplate').mockImplementation((id) =>
    Promise.resolve({
      ...template(id, '光伏总览'),
      payload: {
        schemaVersion: 1,
        name: '光伏总览',
        description: null,
        designWidth: 1920,
        designHeight: 1080,
        themeJson: {},
        chromeJson: {},
        nodes: [],
      },
    }),
  )

  vi.spyOn(templatesApi, 'listDashboardTemplates').mockResolvedValue(
    templatePage([template('t1', '光伏总览')]),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('三种起手方式', () => {
  it('打开时落在空白画布，并预选当前项目', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })

    expect(wrapper.text()).toContain('按下面的设计尺寸开一张空屏')
    expect(wrapper.text()).toContain('A 园区')
  })

  it('空白画布提交时带上设计尺寸，不带来源与模板', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await wrapper.findAll('input')[0]?.setValue('新屏')

    await clickText(wrapper, '创建大屏')

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          startMode: 'blank',
          projectId: 'p1',
          name: '新屏',
          designWidth: 1920,
          designHeight: 1080,
        },
      ],
    ])
  })

  it('复制现有提交时带上源屏 id', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await clickText(wrapper, '复制现有')
    await wrapper.findAll('input')[0]?.setValue('副本屏')

    await clickText(wrapper, '创建大屏')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      startMode: 'copy',
      sourceDashboardId: 'd1',
      includePointBindings: true,
    })
  })

  it('复制时可选择忽略点位绑定', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await clickText(wrapper, '复制现有')
    await wrapper.get('input[type=text]').setValue('副本')
    await wrapper.get('input[type=checkbox]').setValue(false)
    await clickText(wrapper, '创建大屏')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      includePointBindings: false,
    })
  })

  it('套模板时挑一张模板才能提交，且提交带上模板 id', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await clickText(wrapper, '套模板')
    await flushPromises()

    await clickText(wrapper, '创建大屏')
    expect(wrapper.emitted('submit')).toBeUndefined()

    await clickText(wrapper, '光伏总览')
    await flushPromises()
    await clickText(wrapper, '创建大屏')

    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      startMode: 'template',
      templateId: 't1',
      name: '光伏总览',
    })
  })

  it('带着预选模板打开时直接落在套模板那一档', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({
      open: true,
      presetTemplate: { id: 't9', name: '预选模板' },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('把模板实例化成新屏')
  })
})

describe('同名屏与来源为空', () => {
  it('目标项目下已有同名屏时给提示但不拦', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await wrapper.findAll('input')[0]?.setValue('总览')

    expect(wrapper.text()).toContain('已经有同名大屏')

    await clickText(wrapper, '创建大屏')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('一张可复制的屏都没有时说清楚，而不是给个空下拉', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true, dashboardsByProject: {} })
    await clickText(wrapper, '复制现有')

    expect(wrapper.text()).toContain('还没有任何大屏可以复制')
  })
})

describe('关闭', () => {
  it('点取消抛 update:open(false)', async () => {
    const wrapper = mountDialog(true)

    await clickText(wrapper, '取消')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})

describe('模板里的旧联动', () => {
  const old = '0195d258-1d43-7a6c-806c-092dddc12e1e'
  const payload = {
    schemaVersion: 1,
    name: '历史模板',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {
      interactions: [
        {
          id: '弹出说明',
          source: { nodeId: 'key' },
          action: { type: 'openModal', target: old },
        },
      ],
    },
    nodes: [
      {
        clientKey: 'key',
        parentClientKey: null,
        moduleType: 'text',
        configJson: { __label: '包内标题' },
        bindings: [],
        x: 0,
        y: 0,
        w: 100,
        h: 50,
        zIndex: 0,
        isVisible: true,
      },
    ],
  }
  const detail = (id: string) => ({ ...template(id, '历史模板'), payload })
  it('模板库入口必须先读取该模板并完成选择，取消不会提交', async () => {
    const get = vi
      .spyOn(templatesApi, 'getDashboardTemplate')
      .mockResolvedValue(detail('t9'))
    const wrapper = mountDialog(false)
    await wrapper.setProps({
      open: true,
      presetTemplate: { id: 't9', name: '历史模板' },
    })
    await flushPromises()
    expect(get).toHaveBeenCalledWith('t9', expect.any(AbortSignal))
    await clickText(wrapper, '创建大屏')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('弹出说明')
    const selector = wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === '对应的包内节点')
    selector?.vm.$emit('update:modelValue', 'key')
    await wrapper.vm.$nextTick()
    await clickText(wrapper, '创建大屏')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      templateId: 't9',
      interactionNodeMap: { [old]: 'key' },
    })
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()
    await clickText(wrapper, '取消')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })
  it('切换模板丢弃迟到的旧详情，失败只提供重试，重试后才允许确认', async () => {
    let release = () => {}
    const get = vi
      .spyOn(templatesApi, 'getDashboardTemplate')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(detail('t9'))
          }),
      )
      .mockRejectedValueOnce(new Error('详情暂不可用'))
      .mockResolvedValueOnce({
        ...detail('t1'),
        payload: { ...payload, chromeJson: {} },
      })
    const wrapper = mountDialog(false)
    await wrapper.setProps({
      open: true,
      presetTemplate: { id: 't9', name: '历史模板' },
    })
    await flushPromises()
    await clickText(wrapper, '光伏总览')
    await flushPromises()
    release()
    await flushPromises()
    expect(get.mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(wrapper.text()).toContain('请求失败，请重试')
    await clickText(wrapper, '创建大屏')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await clickText(wrapper, '重试')
    await flushPromises()
    await clickText(wrapper, '创建大屏')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      templateId: 't1',
    })
    expect(wrapper.emitted('submit')?.[0]?.[0]).not.toHaveProperty(
      'interactionNodeMap',
    )
  })
})

it('关闭预选模板后再开空白大屏不会读取上次的模板', async () => {
  const detail = vi.spyOn(templatesApi, 'getDashboardTemplate')
  const wrapper = mountDialog(false)
  await wrapper.setProps({
    open: true,
    presetTemplate: { id: 't9', name: '历史模板' },
  })
  await flushPromises()
  await wrapper.setProps({ open: false, presetTemplate: null })
  await wrapper.setProps({ open: true })
  await flushPromises()
  expect(wrapper.text()).toContain('按下面的设计尺寸开一张空屏')
  expect(detail).toHaveBeenCalledTimes(1)
})
