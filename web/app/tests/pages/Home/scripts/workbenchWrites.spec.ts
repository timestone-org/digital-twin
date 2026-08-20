/**
 * @fileoverview 契约：建屏按起手方式分派到三个不同的端点，出参收敛成同一个
 * 形状；导入按「给没给覆盖目标」走新建或覆盖；导入文件先过整包解析再上路。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DashboardImportResult,
  DashboardPayload,
  UnresolvedBinding,
} from '@dt/contracts'

import * as dashboardApi from '@/api/dashboard'
import * as templatesApi from '@/api/dashboardTemplates'
import * as transferApi from '@/api/dashboardTransfer'
import type { NewDashboardPayload } from '@/pages/Home/scripts/payloads'
import {
  createDashboardFrom,
  importInto,
  readExportFile,
} from '@/pages/Home/scripts/workbenchWrites'

function made(id: string, name: string): DashboardPayload {
  return {
    id,
    projectId: 'p1',
    name,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {},
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    nodes: [],
  }
}

const DANGLING: UnresolvedBinding[] = [
  {
    nodeKey: 's1:PV.P',
    fieldKey: 'value',
    sourceKind: 'opcua',
    reason: '点位不存在',
  },
]

function imported(name: string): DashboardImportResult {
  return { ...made('d9', name), unresolvedBindings: DANGLING }
}

const BLANK: NewDashboardPayload = {
  startMode: 'blank',
  projectId: 'p1',
  name: '空白屏',
  designWidth: 2560,
  designHeight: 1440,
}

const PACKAGE = {
  schemaVersion: 1,
  name: '光伏总览',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  themeJson: {},
  chromeJson: {},
  nodes: [],
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('按起手方式分派', () => {
  it('空白画布打建屏端点，并把设计尺寸带上', async () => {
    const spy = vi
      .spyOn(dashboardApi, 'createDashboard')
      .mockResolvedValue(made('d1', '空白屏'))

    const result = await createDashboardFrom(BLANK)

    expect(spy).toHaveBeenCalledWith({
      projectId: 'p1',
      name: '空白屏',
      designWidth: 2560,
      designHeight: 1440,
    })
    expect(result).toEqual({ id: 'd1', name: '空白屏', unresolvedBindings: [] })
  })

  it('复制现有打复制端点，带上新名字与目标项目', async () => {
    const spy = vi
      .spyOn(transferApi, 'duplicateDashboard')
      .mockResolvedValue(made('d2', '副本'))

    await createDashboardFrom({
      ...BLANK,
      startMode: 'copy',
      name: '副本',
      sourceDashboardId: 'src',
    })

    expect(spy).toHaveBeenCalledWith('src', {
      newName: '副本',
      targetProjectId: 'p1',
    })
  })

  it('套模板打实例化端点，并把没接上的绑定原样带回来', async () => {
    const spy = vi
      .spyOn(templatesApi, 'instantiateDashboardTemplate')
      .mockResolvedValue(imported('模板屏'))

    const result = await createDashboardFrom({
      ...BLANK,
      startMode: 'template',
      name: '模板屏',
      templateId: 'tpl',
    })

    expect(spy).toHaveBeenCalledWith('tpl', {
      targetProjectId: 'p1',
      name: '模板屏',
    })
    expect(result.unresolvedBindings).toEqual(DANGLING)
  })

  it('套模板留空名字时不传 name，由服务端沿用模板名', async () => {
    const spy = vi
      .spyOn(templatesApi, 'instantiateDashboardTemplate')
      .mockResolvedValue(imported('模板自带名'))

    await createDashboardFrom({
      ...BLANK,
      startMode: 'template',
      name: '',
      templateId: 'tpl',
    })

    expect(spy).toHaveBeenCalledWith('tpl', {
      targetProjectId: 'p1',
      name: undefined,
    })
  })

  it('复制却没给来源时当场拒，而不是打一个缺参的端点', async () => {
    const spy = vi.spyOn(transferApi, 'duplicateDashboard')

    await expect(
      createDashboardFrom({ ...BLANK, startMode: 'copy' }),
    ).rejects.toThrow('没有选复制来源')
    expect(spy).not.toHaveBeenCalled()
  })

  it('套模板却没给模板时当场拒', async () => {
    await expect(
      createDashboardFrom({ ...BLANK, startMode: 'template' }),
    ).rejects.toThrow('没有选模板')
  })
})

describe('导入', () => {
  it('没给覆盖目标就是新建，只传新名字', async () => {
    const spy = vi
      .spyOn(transferApi, 'importDashboard')
      .mockResolvedValue(imported('新屏'))

    await importInto('p1', PACKAGE, {
      newName: '新屏',
      targetDashboardId: null,
    })

    expect(spy).toHaveBeenCalledWith({
      projectId: 'p1',
      payload: PACKAGE,
      newName: '新屏',
    })
  })

  it('给了覆盖目标就是覆盖，不传新名字（目标屏的名字不改）', async () => {
    const spy = vi
      .spyOn(transferApi, 'importDashboard')
      .mockResolvedValue(imported('被覆盖的屏'))

    await importInto('p1', PACKAGE, { newName: '', targetDashboardId: 'd7' })

    expect(spy).toHaveBeenCalledWith({
      projectId: 'p1',
      payload: PACKAGE,
      targetDashboardId: 'd7',
    })
  })

  it('出参里的未解析绑定原样带回来', async () => {
    vi.spyOn(transferApi, 'importDashboard').mockResolvedValue(imported('屏'))

    const result = await importInto('p1', PACKAGE, {
      newName: '屏',
      targetDashboardId: null,
    })

    expect(result.unresolvedBindings).toEqual(DANGLING)
  })
})

describe('读导入文件', () => {
  it('文件里是线形的包，读出来是 camelCase 的载荷', async () => {
    // 存盘的文件与后端导出的那份同形，故是 snake_case
    const wire = {
      schema_version: 1,
      name: '光伏总览',
      description: null,
      design_width: 1920,
      design_height: 1080,
      theme_json: {},
      chrome_json: {},
      nodes: [],
    }
    const file = new File([JSON.stringify(wire)], 'x.json')

    await expect(readExportFile(file)).resolves.toMatchObject({
      name: '光伏总览',
      designWidth: 1920,
    })
  })

  it('形状不对的文件在这一步就拒，不让它流到导入端点', async () => {
    const file = new File([JSON.stringify({ name: 1 })], 'x.json')

    await expect(readExportFile(file)).rejects.toThrow()
  })
})
