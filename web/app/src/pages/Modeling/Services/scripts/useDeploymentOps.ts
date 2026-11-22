/** @fileoverview 已发布模型的配额、启停与删除。 */
import type { ModelDeployment } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { ref } from 'vue'

import { BizError } from '@/api/client'
import * as modeling from '@/api/modeling'
import { describeError } from '@/composables/useAsyncList'

type Toast = ReturnType<typeof useToast>

/** 删服务前的问话。 */
function removeAsk(deployment: ModelDeployment): {
  title: string
  message: string
  confirmText: string
  danger: boolean
} {
  return {
    title: `删掉「${deployment.name}」？`,
    message:
      `第三方调的那个地址（${deployment.code}）会立刻 404，` +
      '只是想暂停的话，用「停用」而不是删。',
    confirmText: '删掉',
    danger: true,
  }
}

async function attempt<T>(
  task: () => Promise<T>,
  toast: Toast,
): Promise<T | null> {
  try {
    return await task()
  } catch (caught) {
    toast.error(describeError(caught))
    return null
  }
}

type DeploymentPatch = Parameters<typeof modeling.updateModelDeployment>[1]

async function save(
  deploymentId: string,
  patch: DeploymentPatch,
  canConfirm: () => boolean,
  confirm: ReturnType<typeof useConfirm>,
): Promise<ModelDeployment | null> {
  try {
    return await modeling.updateModelDeployment(deploymentId, patch)
  } catch (caught) {
    if (!(caught instanceof BizError) || caught.code !== 41435) throw caught
    if (!canConfirm()) return null
    const accepted = await confirm.ask({
      title: '新版本的调用格式有变化',
      message: '输入字段或输出格式已变化。请核对该部署的调用方已适配新版本。',
      confirmText: '已核对，切换版本',
      danger: true,
    })
    if (!accepted || !canConfirm()) return null
    return modeling.updateModelDeployment(deploymentId, {
      ...patch,
      is_signature_change_confirmed: true,
    })
  }
}

export function useDeploymentOps(onDone: () => void) {
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

  /** 删一个对外服务。⚠ 删之前把爆炸半径说清楚。 */
  async function remove(deployment: ModelDeployment): Promise<void> {
    if (!(await confirm.ask(removeAsk(deployment)))) return
    const done = await run(() => modeling.deleteModelDeployment(deployment.id))
    if (done !== null) toast.success('已删除')
  }

  return {
    isBusy,
    remove,
    /** 换版本、改配额、启停。 */
    update: async (
      deploymentId: string,
      patch: DeploymentPatch,
      canConfirm = () => false,
    ) => {
      const done = await run(() =>
        save(deploymentId, patch, canConfirm, confirm),
      )
      if (done !== null) toast.success('已保存')
      return done
    },
  }
}
