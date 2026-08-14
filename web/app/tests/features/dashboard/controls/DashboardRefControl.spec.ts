/**
 * @fileoverview 契约：挑大屏的控件按注入的项目取候选，取不到时**说出来**并留手填框；
 * 同项目只拉一次；项目被切换时慢的那次后返回不许覆盖新项目的候选。
 * ⚠ 一个空下拉与一次没查成，用户分不出来——后者手填 id 仍然能用。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, provide, ref, type Ref } from 'vue'
import type { ConfigField, DtSelectOption, Page } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import type { DashboardSummary } from '@/api/dashboardWire'
import DashboardRefControl from '@/features/dashboard/controls/DashboardRefControl.vue'
import { resetProjectDashboards } from '@/features/dashboard/controls/dashboardOptions'
import { EDITOR_PROJECT_ID_KEY } from '@/features/dashboard/editorContext'

vi.mock('@/api/dashboard', () => ({ listDashboards: vi.fn() }))

const { listDashboards } = await import('@/api/dashboard')

const FIELD: ConfigField = {
  key: 'target',
  label: '跳转到',
  type: 'dashboard-ref',
}

function summary(id: string, name: string): DashboardSummary {
  return {
    id,
    projectId: 'p-1',
    name,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    nodeCount: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  }
}

function page(items: DashboardSummary[]): Page<DashboardSummary> {
  return { items, page: 1, size: 100, total: items.length }
}

interface Deferred<TValue> {
  promise: Promise<TValue>
  resolve: (value: TValue) => void
}

/** 手动落定的响应，用来把两次请求的返回顺序摆成「旧的后到」。 */
function deferred<TValue>(): Deferred<TValue> {
  let settle: (value: TValue) => void = () => undefined
  const promise = new Promise<TValue>((done) => {
    settle = done
  })
  return { promise, resolve: (value) => settle(value) }
}

/** 一个只负责下发项目上下文的宿主，控件挂在它下面。 */
function mountRef(projectId: Ref<string | null> | null, value: unknown = '') {
  const host = defineComponent({
    setup() {
      if (projectId !== null) provide(EDITOR_PROJECT_ID_KEY, projectId)
      return () => h(DashboardRefControl, { field: FIELD, value })
    },
  })
  return mount(host)
}

function control(wrapper: ReturnType<typeof mountRef>) {
  return wrapper.findComponent(DashboardRefControl)
}

function optionLabels(wrapper: ReturnType<typeof mountRef>): string[] {
  const options: readonly DtSelectOption[] = wrapper
    .findComponent(DtSelect)
    .props('options')
  return options.map((option) => option.label)
}

/** 最后一次抛出的 `update`。 */
function lastUpdate(wrapper: ReturnType<typeof mountRef>): unknown[] {
  const events = control(wrapper).emitted('update') ?? []
  return events.at(-1) ?? []
}

beforeEach(() => {
  resetProjectDashboards()
  vi.mocked(listDashboards).mockReset()
})

describe('有项目上下文', () => {
  it('下拉列出这个项目下的大屏', async () => {
    vi.mocked(listDashboards).mockResolvedValue(
      page([summary('d-1', '产线总览'), summary('d-2', '能耗看板')]),
    )

    const wrapper = mountRef(ref('p-1'))
    await flushPromises()

    expect(optionLabels(wrapper)).toStrictEqual([
      '（未选择）',
      '产线总览',
      '能耗看板',
    ])
    expect(vi.mocked(listDashboards).mock.calls[0]?.[0]).toMatchObject({
      projectId: 'p-1',
    })
  })

  it('选一张大屏抛出它的 id', async () => {
    vi.mocked(listDashboards).mockResolvedValue(page([summary('d-2', '能耗')]))
    const wrapper = mountRef(ref('p-1'))
    await flushPromises()

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'd-2')
    await wrapper.vm.$nextTick()

    expect(lastUpdate(wrapper)).toStrictEqual(['d-2', false])
  })

  it('选回「未选择」是取消这一项的配置', async () => {
    vi.mocked(listDashboards).mockResolvedValue(page([summary('d-2', '能耗')]))
    const wrapper = mountRef(ref('p-1'), 'd-2')
    await flushPromises()

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', '')
    await wrapper.vm.$nextTick()

    expect(lastUpdate(wrapper)).toStrictEqual([undefined, false])
  })

  it('已选的 id 不在列表里时补一条占位，不把它回显成未选择', async () => {
    vi.mocked(listDashboards).mockResolvedValue(page([summary('d-1', '总览')]))

    const wrapper = mountRef(ref('p-1'), 'd-9')
    await flushPromises()

    expect(wrapper.findComponent(DtSelect).props('modelValue')).toBe('d-9')
    expect(optionLabels(wrapper)).toContain('（列表外 d-9）')
  })
})

describe('取不到候选', () => {
  it('没人下发项目时显式说出来，并留一个手填框', () => {
    const wrapper = mountRef(null, 'd-7')

    expect(wrapper.text()).toContain('取不到大屏列表')
    expect(wrapper.findComponent(DtSelect).exists()).toBe(false)
    expect(vi.mocked(listDashboards)).not.toHaveBeenCalled()
  })

  it('拉取失败时同样显式说出来，而不是给一个空下拉', async () => {
    vi.mocked(listDashboards).mockRejectedValue(new Error('boom'))

    const wrapper = mountRef(ref('p-1'))
    await flushPromises()

    expect(wrapper.text()).toContain('取不到大屏列表')
    expect(wrapper.findComponent(DtSelect).exists()).toBe(false)
  })

  it('手填的 id 照样上抛', async () => {
    const wrapper = mountRef(null)

    await wrapper.find('.dt-input__el').setValue('d-手填')

    expect(lastUpdate(wrapper)).toStrictEqual(['d-手填', false])
  })
})

describe('缓存与竞态', () => {
  it('同一个项目只拉一次，一张屏上放几个字段也不重复请求', async () => {
    vi.mocked(listDashboards).mockResolvedValue(page([summary('d-1', '总览')]))

    const first = mountRef(ref('p-1'))
    const second = mountRef(ref('p-1'))
    await flushPromises()

    expect(vi.mocked(listDashboards)).toHaveBeenCalledTimes(1)
    expect(optionLabels(first)).toStrictEqual(optionLabels(second))
  })

  it('换了项目之后，旧项目慢一步的响应不许覆盖新项目的候选', async () => {
    const slow = deferred<Page<DashboardSummary>>()
    const fast = deferred<Page<DashboardSummary>>()
    vi.mocked(listDashboards)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const projectId = ref<string | null>('p-1')
    const wrapper = mountRef(projectId)

    projectId.value = 'p-2'
    await wrapper.vm.$nextTick()
    fast.resolve(page([summary('d-2', '新项目的屏')]))
    await flushPromises()
    slow.resolve(page([summary('d-1', '旧项目的屏')]))
    await flushPromises()

    expect(optionLabels(wrapper)).toStrictEqual(['（未选择）', '新项目的屏'])
  })

  it('换项目的一瞬间先清空旧候选，不让它顶着新项目的名字', async () => {
    vi.mocked(listDashboards).mockResolvedValue(page([summary('d-1', '总览')]))
    const projectId = ref<string | null>('p-1')
    const wrapper = mountRef(projectId)
    await flushPromises()

    projectId.value = 'p-2'
    await wrapper.vm.$nextTick()

    expect(optionLabels(wrapper)).toStrictEqual(['（未选择）'])
  })
})
