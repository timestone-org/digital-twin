/**
 * @fileoverview 运行表长流水线名称和回跳目标。
 */
import type { ModelingRunSummary } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RunTable from '@/pages/Modeling/Runs/components/RunTable.vue'

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

describe('运行记录长文本', () => {
  it('长流水线名称截断且完整名称与目标运行仍可访问', () => {
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

  it('已删除流水线的标识仍作为可读名称提示', () => {
    const wrapper = open(new Map())
    const link = wrapper.get('.dt-ml-runs__link')
    expect(link.text()).toBe(RUN.pipeline_id)
    expect(link.attributes('title')).toBe(RUN.pipeline_id)
    wrapper.unmount()
  })
})
