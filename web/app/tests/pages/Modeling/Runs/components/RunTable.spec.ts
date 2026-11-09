/**
 * @fileoverview 运行表长工作流名称和回跳目标。
 */
import type { ModelingRunSummary } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
beforeEach(() => setActivePinia(createPinia()))

import RunTable from '@/pages/Modeling/Runs/components/RunTable.vue'
import RunActions from '@/pages/Modeling/Runs/components/RunActions.vue'
import RunStatus from '@/pages/Modeling/Runs/components/RunStatus.vue'
import { useAuthStore } from '@/stores/auth'
afterEach(() => vi.restoreAllMocks())

const RUN: ModelingRunSummary = {
  id: 'r1',
  pipeline_id: 'p1',
  status: 'failed',
  trigger: 'manual',
  started_at: null,
  finished_at: null,
  duration_ms: null,
  row_count: null,
  is_source_truncated: false,
  is_keeping_frames: false,
  error_text: `missing_feature_${'K'.repeat(64)}`,
  created_by_name: null,
  created_at: '2026-01-01T00:00:00.000Z',
}

function open(names: ReadonlyMap<string, string>) {
  return mount(RunTable, {
    props: {
      rows: [RUN],
      pipelineNames: names,
      publishedRunIds: new Set<string>(),
      canPublish: false,
      view: 'table',
      isLoading: false,
      error: null,
    },
    global: {
      stubs: {
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
}

function interactiveTable() {
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
  return mount(RunTable, {
    props: {
      rows: [{ ...RUN, status: 'succeeded', duration_ms: 500 }],
      pipelineNames: new Map([['p1', '能耗分析']]),
      publishedRunIds: new Set(['r1']),
      canPublish: true,
      view: 'table',
      isLoading: false,
      error: null,
      pagination: { page: 1, size: 20, total: 61 },
    },
    global: {
      stubs: {
        Teleport: true,
        PermGuard: { props: ['codes'], template: '<slot />' },
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  })
}

describe('运行记录长文本', () => {
  it('两种视图优先采用后端同行工作流名称，无需完整目录映射', async () => {
    const wrapper = open(new Map([['p1', '旧目录名称']]))
    await wrapper.setProps({
      rows: [
        {
          ...RUN,
          pipeline_name: '后端工作流名称',
          pipeline_code: 'server_pipeline',
        },
      ],
    })
    expect(wrapper.get('.dt-ml-runs__link').text()).toBe('后端工作流名称')
    expect(wrapper.get('.dt-ml-runs__link').attributes('title')).toBe(
      '后端工作流名称',
    )
    await wrapper.setProps({ view: 'card' })
    expect(wrapper.get('.dt-ml-runs__link').text()).toBe('后端工作流名称')
    wrapper.unmount()
  })
  it('长工作流名称截断且完整名称与目标运行仍可访问', () => {
    const name = 'P'.repeat(128)
    const wrapper = open(new Map([['p1', name]]))
    const link = wrapper.get('.dt-ml-runs__link')
    expect(link.text()).toBe(name)
    expect(link.attributes('title')).toBe(name)
    expect(link.classes()).toEqual(
      expect.arrayContaining(['block', 'truncate']),
    )
    expect(link.attributes('href')).toBe('/modeling/pipelines/p1?run_id=r1')
    expect(wrapper.get('.dt-ml-runs__why').attributes('title')).toBe(
      RUN.error_text,
    )
    wrapper.unmount()
  })

  it('已删除工作流的标识仍作为可读名称提示', () => {
    const wrapper = open(new Map())
    const link = wrapper.get('.dt-ml-runs__link')
    expect(link.text()).toBe(RUN.pipeline_id)
    expect(link.attributes('title')).toBe(RUN.pipeline_id)
    wrapper.unmount()
  })
})

describe.each(['table', 'card'] as const)('历史结果入口：%s', (view) => {
  it('按实际点击的训练记录发出详情事件', async () => {
    const rows = [RUN, { ...RUN, id: 'r2', status: 'succeeded' as const }]
    const wrapper = mount(RunTable, {
      props: {
        rows,
        pipelineNames: new Map([['p1', '能耗分析']]),
        publishedRunIds: new Set<string>(),
        canPublish: false,
        view,
        isLoading: false,
        error: null,
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
    const results = wrapper.findAll('button[aria-label="查看训练结果"]')
    expect(results).toHaveLength(2)
    await results[1]?.trigger('click')
    expect(wrapper.emitted('detail')).toEqual([[rows[1]]])
    wrapper.unmount()
  })
})

it('分页和每页数量从实际控件传给列表拥有者，展示切换保留原事件', async () => {
  const wrapper = interactiveTable()
  const next = wrapper
    .findAll('button')
    .find((button) => button.text() === '下一页')
  if (!next) throw new Error('缺少下一页')
  await next.trigger('click')
  expect(wrapper.emitted('update:page')).toEqual([[2]])
  await wrapper.get('button[aria-label="每页条数"]').trigger('click')
  const size = wrapper
    .findAll('[role="option"]')
    .find((option) => option.text() === '50 条/页')
  if (!size) throw new Error('缺少每页50条')
  await size.trigger('click')
  expect(wrapper.emitted('update:size')).toEqual([[50]])
  await wrapper.get('button[aria-label="卡片视图"]').trigger('click')
  expect(wrapper.emitted('update:view')).toEqual([['card']])
  wrapper.unmount()
})

async function menuAction(wrapper: VueWrapper, text: string): Promise<void> {
  await wrapper.get('button[aria-label="训练记录更多操作"]').trigger('click')
  await flushPromises()
  const item = wrapper
    .findAll('[role="menuitem"]')
    .find((entry) => entry.text() === text)
  if (!item) throw new Error(`缺少菜单动作：${text}`)
  await item.trigger('click')
  await flushPromises()
}

it('发布和删除菜单继续传回当前训练记录', async () => {
  const wrapper = interactiveTable()
  await menuAction(wrapper, '发布模型')
  await menuAction(wrapper, '删除记录')
  expect(wrapper.emitted('publish')).toEqual([
    [{ ...RUN, status: 'succeeded', duration_ms: 500 }],
  ])
  expect(wrapper.emitted('remove')).toEqual(wrapper.emitted('publish'))
  wrapper.unmount()
})

it.each(['table', 'card'] as const)(
  '%s 发布状态属于状态展示，操作只提供查看与更多菜单',
  async (view) => {
    const wrapper = interactiveTable()
    await wrapper.setProps({
      view,
      rows: [{ ...RUN, status: 'succeeded', publication_status: 'published' }],
    })
    expect(wrapper.getComponent(RunStatus).text()).toContain('已发布')
    expect(wrapper.getComponent(RunStatus).text()).toContain('成功')
    expect(wrapper.getComponent(RunActions).text()).not.toContain('已发布')
    expect(wrapper.getComponent(RunActions).findAll('button')).toHaveLength(2)
    if (view === 'table') {
      const cells = wrapper.findAll('tbody tr')[0]?.findAll('td')
      expect(cells?.[1]?.text()).toContain('已发布')
      expect(cells?.at(-1)?.text()).not.toContain('已发布')
    }
    wrapper.unmount()
  },
)

it('加载失败提供真实重试按钮并向列表拥有者发出重试', async () => {
  const wrapper = interactiveTable()
  await wrapper.setProps({ error: '训练记录暂时无法读取' })
  expect(wrapper.text()).toContain('训练记录暂时无法读取')
  const retry = wrapper
    .findAll('button')
    .find((button) => button.text() === '重试')
  if (!retry) throw new Error('缺少重试')
  await retry.trigger('click')
  expect(wrapper.emitted('retry')).toEqual([[]])
  wrapper.unmount()
})

it('多条训练记录的菜单只转发实际点击的目标row', async () => {
  const wrapper = interactiveTable()
  const rows = [
    { ...RUN, status: 'succeeded' as const },
    { ...RUN, id: 'r2', status: 'succeeded' as const },
  ]
  await wrapper.setProps({ rows })
  const second = wrapper.findAllComponents(RunActions)[1]
  if (!second) throw new Error('缺少第二条记录操作')
  await menuAction(second, '发布模型')
  await menuAction(second, '删除记录')
  expect(wrapper.emitted('publish')).toEqual([[rows[1]]])
  expect(wrapper.emitted('remove')).toEqual([[rows[1]]])
  wrapper.unmount()
})

describe('失败原因那一列', () => {
  it('训练成功但发布失败时写出发布失败的原因', async () => {
    const wrapper = open(new Map())
    await wrapper.setProps({
      rows: [
        {
          ...RUN,
          status: 'succeeded',
          error_text: null,
          publication_status: 'failed',
          publication_error: '模型输入输出签名已改变',
        },
      ],
    })

    expect(wrapper.find('.dt-ml-runs__why').text()).toBe(
      '发布：模型输入输出签名已改变',
    )
  })
})
