/**
 * @fileoverview 一张大屏的加载与保存的状态壳；IO 行为在 `features/dashboard/docIo.ts`。
 * ⚠ 加载防竞态（序号 + AbortController 双保险）与「409 绝不静默覆盖」的口径见那里。
 */

import { ref, type Ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'

import type { DashboardPatchInput, ReplaceLayoutInput } from '@/api/dashboard'
import {
  VERSION_CONFLICT_MESSAGE,
  createLoader,
  createMetaSaver,
  createSaver,
  type DocState,
} from '@/features/dashboard/docIo'

export { VERSION_CONFLICT_MESSAGE }

export interface DashboardDoc {
  dashboard: Ref<DashboardPayload | null>
  loading: Ref<boolean>
  saving: Ref<boolean>
  error: Ref<string | null>
  /** 版本冲突的提示；非 null 时界面必须挡住继续保存。 */
  conflict: Ref<string | null>
  /** 加载一张大屏；返回它，被更晚的一次加载取代时返回 null。 */
  load: (dashboardId: string) => Promise<DashboardPayload | null>
  /** 整树替换；成功返回新载荷，冲突或失败返回 null。 */
  save: (input: ReplaceLayoutInput) => Promise<DashboardPayload | null>
  /**
   * 元数据轴保存（名称/尺寸/主题与外观袋）。成功后当前载荷换成服务端返回的
   * 新版本——行版本被推进了，随后的整树替换必须用新版本号。
   */
  saveMeta: (patch: DashboardPatchInput) => Promise<DashboardPayload | null>
  /** 卸载时掐掉在途请求。 */
  dispose: () => void
}

export function useDashboardDoc(): DashboardDoc {
  const state: DocState = {
    dashboard: ref<DashboardPayload | null>(null),
    loading: ref(false),
    saving: ref(false),
    error: ref<string | null>(null),
    conflict: ref<string | null>(null),
  }
  const { load, dispose } = createLoader(state)
  return {
    ...state,
    load,
    save: createSaver(state),
    saveMeta: createMetaSaver(state),
    dispose,
  }
}
