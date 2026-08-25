/**
 * @fileoverview 契约：运行态预览喂给模块的是「节点存量配置 + 注回草稿」。
 *
 * ⚠ 注回的键只能来自清单的 `subEditor.configKey`：在子编辑器里写死某个模块的
 * 键，换个模块进来预览的就是存量配置，而画面上看不出它是旧的。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { twinRuntimePreviewOf } from '@/pages/TwinEditor/scripts/runtimePreview'

const DRAFT = normalizeTwinConfig({ model: { asset: 'asset:new' } })

function node(
  overrides: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'twin-view',
    x: 0,
    y: 0,
    w: 1280,
    h: 720,
    zIndex: 1,
    isVisible: true,
    configJson: { title: '一号厂区', twin: { model: { asset: 'asset:old' } } },
    bindings: [],
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

function manifest(subEditorKey: string | null): ModuleManifest {
  const base = {
    type: 'twin-view',
    displayName: '数字孪生',
    category: '孪生',
    defaultSize: { width: 1280, height: 720 },
    configSchema: [],
    bindings: [],
    component: () => Promise.resolve({ default: {} }),
  }
  return subEditorKey === null
    ? base
    : {
        ...base,
        subEditor: {
          configKey: subEditorKey,
          routeName: 'twin-editor',
          label: '打开孪生编辑器',
        },
      }
}

const lookup = (key: string | null) => () => manifest(key)

describe('twinRuntimePreviewOf', () => {
  it('草稿注回清单声明的那个键，其余配置原样带上', () => {
    const input = twinRuntimePreviewOf(node(), DRAFT, lookup('twin'))

    expect(input).toEqual({
      nodeId: 'n1',
      moduleType: 'twin-view',
      config: { title: '一号厂区', twin: DRAFT },
    })
  })

  // ⚠ 预览到的必须是内存里这一份：拿存量那份预览，改了半天画面纹丝不动
  it('注回的是草稿，不是节点上存量的那一段', () => {
    const input = twinRuntimePreviewOf(node(), DRAFT, lookup('twin'))

    expect(input?.config.twin).toBe(DRAFT)
  })

  it('清单没声明子编辑器就预览不了', () => {
    expect(twinRuntimePreviewOf(node(), DRAFT, lookup(null))).toBeNull()
  })

  it('模块没注册就预览不了', () => {
    expect(twinRuntimePreviewOf(node(), DRAFT, () => undefined)).toBeNull()
  })

  it.each([
    ['节点还没读出来', null, DRAFT],
    ['配置还没读出来', node(), null],
  ])('%s 时给 null', (_name, target, draft) => {
    expect(twinRuntimePreviewOf(target, draft, lookup('twin'))).toBeNull()
  })
})
