/** @fileoverview 训练与发布状态在状态列显示，并保留失败原因和历史发布说明。 */
import type { ModelingRunStatus, ModelingRunSummary } from '@dt/contracts'
import { DtTag } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import RunStatus from '@/pages/Modeling/Runs/components/RunStatus.vue'
const RUN: ModelingRunSummary = {
  id: 'r1',
  pipeline_id: 'p1',
  status: 'succeeded',
  trigger: 'manual',
  started_at: null,
  finished_at: null,
  duration_ms: null,
  row_count: 10,
  is_source_truncated: false,
  is_keeping_frames: false,
  error_text: null,
  created_by_name: null,
  created_at: '2026-11-03T00:00:00Z',
}
it.each<{ status: ModelingRunStatus; label: string; intent: string }>([
  { status: 'pending', label: '排队中', intent: 'neutral' },
  { status: 'running', label: '运行中', intent: 'info' },
  { status: 'cancelling', label: '取消中', intent: 'warning' },
  { status: 'succeeded', label: '成功', intent: 'success' },
  { status: 'failed', label: '失败', intent: 'danger' },
  { status: 'cancelled', label: '已取消', intent: 'neutral' },
])('$status 保留训练状态文字与色档', ({ status, label, intent }) => {
  const wrapper = mount(RunStatus, {
    props: { run: { ...RUN, status }, isSavedModel: false },
  })
  expect(wrapper.getComponent(DtTag).text()).toBe(label)
  expect(wrapper.getComponent(DtTag).props('intent')).toBe(intent)
  expect(wrapper.find('button').exists()).toBe(false)
  wrapper.unmount()
})
it('已发布说明对应本次训练的发布历史，不把它当当前线上版本', () => {
  const wrapper = mount(RunStatus, {
    props: {
      run: { ...RUN, publication_status: 'published' },
      isSavedModel: true,
    },
  })
  const caption = wrapper.get('.run-status__publication')
  expect(caption.text()).toBe('已发布')
  expect(caption.attributes('title')).toContain('曾完成发布')
  expect(caption.attributes('title')).toContain('当前调用版本')
  wrapper.unmount()
})
it('发布中显示独立说明，不替换训练成功状态', () => {
  const wrapper = mount(RunStatus, {
    props: {
      run: { ...RUN, publication_status: 'pending' },
      isSavedModel: true,
    },
  })
  expect(wrapper.getComponent(DtTag).text()).toBe('成功')
  expect(wrapper.get('.run-status__publication').text()).toBe('发布中')
  expect(wrapper.get('.run-status__publication').classes()).toContain(
    'run-status__publication--pending',
  )
  wrapper.unmount()
})
it.each(['模型签名变化，发布被拒绝', null])(
  '发布失败保留原因或状态说明：%s',
  (error) => {
    const wrapper = mount(RunStatus, {
      props: {
        run: { ...RUN, publication_status: 'failed', publication_error: error },
        isSavedModel: true,
      },
    })
    const caption = wrapper.get('.run-status__publication')
    expect(caption.text()).toBe('发布失败')
    expect(caption.attributes('title')).toBe(error ?? '发布失败')
    expect(caption.classes()).toContain('run-status__publication--failed')
    wrapper.unmount()
  },
)
it.each(['not_requested', 'skipped', null] as const)(
  '未更新发布入口的%s状态仍可说明模型已保存',
  (status) => {
    const wrapper = mount(RunStatus, {
      props: {
        run: { ...RUN, publication_status: status },
        isSavedModel: true,
      },
    })
    expect(wrapper.get('.run-status__publication').text()).toBe('模型已保存')
    wrapper.unmount()
  },
)
it('没有模型或发布说明时只显示训练状态', () => {
  const wrapper = mount(RunStatus, { props: { run: RUN, isSavedModel: false } })
  expect(wrapper.text()).toBe('成功')
  expect(wrapper.find('.run-status__publication').exists()).toBe(false)
  wrapper.unmount()
})
