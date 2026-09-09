/**
 * @fileoverview 大屏节点的 manifest 跨字段校验汇总契约。
 */
import type {
  BindingPayload,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { moduleConfigIssues } from '@/features/dashboard/moduleConfigIssues'

const MANIFEST: ModuleManifest = {
  type: 'gauge',
  displayName: '仪表',
  category: '数据',
  defaultSize: { width: 100, height: 100 },
  configSchema: [
    { key: 'min', label: '下限', type: 'number', default: 0 },
    { key: 'max', label: '上限', type: 'number', default: 100 },
  ],
  validateConfig: (config) =>
    Number(config.max) > Number(config.min) ? [] : ['上限必须大于下限'],
  validateBindings: (config, bindings) =>
    bindings.length > 0 && config.zone !== 'UTC'
      ? ['绑定时区必须与模块一致']
      : [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(
  configJson: Record<string, unknown>,
  bindings: BindingPayload[] = [],
): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'gauge',
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    zIndex: 0,
    isVisible: true,
    configJson,
    createdAt: '',
    updatedAt: '',
    bindings,
  }
}

const BINDING: BindingPayload = {
  id: 'b1',
  nodeId: 'n1',
  fieldKey: 'value',
  sourceKind: 'static',
  nodeKey: null,
  staticValueJson: 1,
  computeJson: null,
  detailJson: null,
  transformJson: null,
  createdAt: '',
  updatedAt: '',
}

const INVALID_TIMEZONE_BINDING: BindingPayload = {
  ...BINDING,
  sourceKind: 'archive',
  fieldKey: 'series[0].value',
  staticValueJson: null,
  detailJson: {
    nodeKey: 's1:p1',
    range: { lastWindow: '7d' },
    timezone: 'Mars/Olympus',
  },
}

describe('模块配置校验', () => {
  it('先铺清单缺省再校验，并带上节点显示名', () => {
    const issues = moduleConfigIssues([node({ max: -1 })], () => MANIFEST)

    expect(issues).toEqual(['仪表：上限必须大于下限'])
  })

  it('未注册模块与合法配置不产生误报', () => {
    expect(moduleConfigIssues([node({ max: 10 })], () => MANIFEST)).toEqual([])
    expect(moduleConfigIssues([node({ max: -1 })], () => undefined)).toEqual([])
  })

  it('配置与绑定的联合错误进入同一份汇总', () => {
    expect(
      moduleConfigIssues(
        [node({ min: 0, max: 10 }, [BINDING])],
        () => MANIFEST,
      ),
    ).toEqual(['仪表：绑定时区必须与模块一致'])
  })

  it('所有模块都会拒绝无效的历史分桶时区', () => {
    expect(
      moduleConfigIssues(
        [node({ min: 0, max: 10, zone: 'UTC' }, [INVALID_TIMEZONE_BINDING])],
        () => MANIFEST,
      ),
    ).toEqual(['仪表：绑定 series[0].value 的分桶时区不是有效的 IANA 时区'])
  })

  it('时区前后空格不会被误判为运行时可用', () => {
    const spaced = {
      ...INVALID_TIMEZONE_BINDING,
      detailJson: {
        nodeKey: 's1:p1',
        range: {},
        timezone: ' Asia/Shanghai ',
      },
    }

    expect(
      moduleConfigIssues(
        [node({ min: 0, max: 10, zone: 'UTC' }, [spaced])],
        () => MANIFEST,
      ),
    ).toEqual(['仪表：绑定 series[0].value 的分桶时区不是有效的 IANA 时区'])
  })
})
