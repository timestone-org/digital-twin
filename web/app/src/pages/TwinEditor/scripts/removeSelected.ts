/** @fileoverview Delete 键删当前选中：有连带影响时先确认，与大纲的删除同一口径。 */
import type { TwinConfig } from '@dt/twin-config'
import type { DtConfirmRequest } from '@dt/ui'

import { twinRemoveImpactText } from './outlineNodes'
import type { TwinEntityKind, TwinSelection } from './types'

export interface RemoveSelectedDeps {
  config: TwinConfig | null
  selection: TwinSelection
  /** 二次确认；回 true 才删。 */
  ask: (request: DtConfirmRequest) => Promise<boolean>
  remove: (kind: TwinEntityKind, id: string) => void
}

/**
 * 删掉当前选中的实体；单例段（模型、视点切换、漫游）不可删，什么都不做。
 * @param deps 配置、选中、确认与删除的落点
 */
export async function removeSelectedEntity(
  deps: RemoveSelectedDeps,
): Promise<void> {
  const { config, selection } = deps
  if (!('id' in selection) || config === null) return
  const impact = twinRemoveImpactText(config, selection.kind, selection.id)
  if (impact !== '') {
    const ok = await deps.ask({
      title: '删除选中对象',
      message: impact,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
  }
  deps.remove(selection.kind, selection.id)
}
