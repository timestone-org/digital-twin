/**
 * @fileoverview 运行态预览要喂给模块的那一袋配置：节点上存量的那份，
 * 加上把编辑器内存里的草稿注回它自己的那个键。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import type { TwinConfig } from '@dt/twin-config'

/** 一次预览的输入，与运行态装配点收的那几样对齐。 */
export interface TwinRuntimePreviewInput {
  /** 节点 id；模块的 `meta` 与联动都按它认这一格。 */
  nodeId: string
  moduleType: string
  /** 模块真正会收到的配置。 */
  config: Record<string, unknown>
}

/**
 * 装配一次预览；节点还没读出来、模块没注册、或清单没声明子编辑器时给 null。
 *
 * ⚠ 草稿注回的是**清单声明的那个键**（`subEditor.configKey`），不在这里写死
 * 孪生的键：子编辑器与它编的模块之间只有清单这一条约定，写死的话换个模块
 * 进来预览到的是存量配置，而画面上看不出它是旧的。
 * @param node 被编辑的大屏节点
 * @param draft 编辑器内存里的这份配置
 * @param lookup 按模块类型取清单
 */
export function twinRuntimePreviewOf(
  node: DashboardNodePayload | null,
  draft: TwinConfig | null,
  lookup: (type: string) => ModuleManifest | undefined,
): TwinRuntimePreviewInput | null {
  if (node === null || draft === null) return null
  const key = lookup(node.moduleType)?.subEditor?.configKey ?? ''
  if (key === '') return null
  return {
    nodeId: node.id,
    moduleType: node.moduleType,
    config: { ...node.configJson, [key]: draft },
  }
}
