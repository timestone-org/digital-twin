/**
 * @fileoverview 弹窗开关的契约。工作台的弹窗组件按这份状态渲染，
 * ⚠ 换目标时旧目标必须一起换掉：留着的话「分享 A 之后另存 B」会把 A 存成模板。
 */
import { describe, expect, it } from 'vitest'

import type { DashboardSummary } from '@/api/dashboardWire'
import { WORKBENCH_DIALOGS } from '@/pages/Home/dialogs'
import { useWorkbenchDialogs } from '@/pages/Home/composables/useWorkbenchDialogs'

function dashboard(id: string): DashboardSummary {
  return {
    id,
    projectId: 'p-1',
    name: id,
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

describe('弹窗开关', () => {
  it('一开始一个都不开', () => {
    const dialogs = useWorkbenchDialogs()
    expect(dialogs.openName.value).toBeNull()
    for (const name of WORKBENCH_DIALOGS) {
      expect(dialogs.isOpen(name)).toBe(false)
    }
  })

  it('开一个就只有这一个是开的', () => {
    const dialogs = useWorkbenchDialogs()
    dialogs.open('share', dashboard('d-1'))
    expect(dialogs.isOpen('share')).toBe(true)
    expect(dialogs.isOpen('validate')).toBe(false)
  })

  it('换弹窗时目标一起换，不留上一个的', () => {
    const dialogs = useWorkbenchDialogs()
    dialogs.open('share', dashboard('d-1'))
    dialogs.open('template-library')
    expect(dialogs.target.value).toBeNull()
  })

  it('关掉之后开关与目标都清干净', () => {
    const dialogs = useWorkbenchDialogs()
    dialogs.open('validate', dashboard('d-2'))
    dialogs.close()
    expect(dialogs.openName.value).toBeNull()
    expect(dialogs.target.value).toBeNull()
  })

  it('两次调用之间互不影响——不是模块级单例', () => {
    const first = useWorkbenchDialogs()
    const second = useWorkbenchDialogs()
    first.open('import')
    expect(second.isOpen('import')).toBe(false)
  })
})
