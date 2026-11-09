/**
 * @fileoverview 版本上的两个动作：下线、一键注册为公式。
 *
 * 与绑定那一组分开：这两个动作的对象是**版本**，爆炸半径也不同——下线是归档，
 * 仍被部署或公式引用的版本由服务端拒绝；注册则是往公式库里写一条新东西
 * （docs/MODELING_PLATFORM_DESIGN.md D17）。
 */
import type {
  ModelFormulaRegistration,
  ModelingVersionSummary,
} from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { ref } from 'vue'

import * as modeling from '@/api/modeling'
import { deleteModelingVersion } from '@/api/modelingWorkflow'

import { attempt } from './useBindingOps'

/** 下线前的问话。⚠ 要说清仍被引用时会被拒绝、下线后可恢复。 */
function retireAsk(
  name: string,
  version: number,
): {
  title: string
  message: string
  confirmText: string
  danger: boolean
} {
  return {
    title: `下线「${name}」v${version}？`,
    message:
      '下线即归档：版本从可用列表中移除，之后可以恢复。仍有部署指向它或公式绑定它时，服务端会拒绝下线，请先切换部署、解除绑定。',
    confirmText: '下线',
    danger: true,
  }
}

interface VersionRemoval {
  confirm: ReturnType<typeof useConfirm>
  run: <T>(task: () => Promise<T>) => Promise<T | null>
  toast: ReturnType<typeof useToast>
}
async function removeVersion(
  row: ModelingVersionSummary,
  actions: VersionRemoval,
): Promise<void> {
  if (
    !(await actions.confirm.ask({
      title: '删除这个训练模型？',
      message:
        '将永久删除此模型版本。已部署、绑定公式或用于版本切换历史的模型会受到保护；原训练记录保留。',
      confirmText: '删除模型',
      danger: true,
    }))
  )
    return
  const done = await actions.run(async () => {
    await deleteModelingVersion(row.id)
    return true
  })
  if (done !== null) actions.toast.success('模型已删除')
}

export function useVersionOps(onDone: () => void) {
  const isBusy = ref(false)
  const toast = useToast()
  const confirm = useConfirm()

  async function run<T>(task: () => Promise<T>): Promise<T | null> {
    isBusy.value = true
    const done = await attempt(task, toast)
    isBusy.value = false
    if (done !== null) onDone()
    return done
  }

  return {
    isBusy,
    rename: async (versionId: string, name: string, description: string) => {
      const done = await run(() =>
        modeling.updateModelingVersion(versionId, { name, description }),
      )
      if (done !== null) toast.success('模型名称已保存')
      return done
    },
    remove: (row: ModelingVersionSummary) =>
      removeVersion(row, { confirm, run, toast }),
    /** 下线（归档）一个版本。 */
    retire: async (row: ModelingVersionSummary) => {
      if (!(await confirm.ask(retireAsk(row.name, row.version)))) return
      const done = await run(() => modeling.archiveModelingVersion(row.id))
      if (done !== null) toast.success('已下线')
    },
    /**
     * 一键注册为公式：一步建条目 + 建绑定。
     *
     * ⚠ 要**同时**有 `modeling:publish` 与 `dataset:manage`；缺后者时按钮由
     * `PermGuard` 禁用并说明原因，不是点下去才报错。
     */
    register: async (
      versionId: string,
      fxCode: string,
    ): Promise<ModelFormulaRegistration | null> => {
      const done = await run(() =>
        modeling.registerModelingFormula(versionId, fxCode),
      )
      if (done !== null) {
        toast.success(
          `已建好公式「${done.formula.code}」并绑上。` +
            `到台账里给某一列写 @${done.formula.code}(…) 就能出数。`,
        )
      }
      return done
    },
  }
}
