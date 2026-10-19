/** @fileoverview 层级图组合式状态的真实组件生命周期夹具。 */
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { required } from '../pages/Tools/Hierarchy/scripts/required'
import { SAMPLE } from '../pages/Tools/Hierarchy/scripts/sample'
import type { HierarchyProject } from '@dt/contracts'
export function harness<T>(factory: () => T) {
  let state: T | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        state = factory()
        return () => h('div')
      },
    }),
  )
  return { state: required(state), wrapper }
}
export function project(id = 'project-1', revision = 1): HierarchyProject {
  return {
    id,
    revision,
    title: SAMPLE.title,
    node_count: 33,
    updated_at: '2026-10-19T00:00:00.000Z',
    document: structuredClone(SAMPLE),
  }
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('未初始化')
  }
  let reject: (error: Error) => void = () => {
    throw new Error('未初始化')
  }
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
