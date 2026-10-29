/** @fileoverview 对外服务的创建、配额、启停与删除。 */
import type { ModelDeployment } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import { ref } from 'vue'

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

/** 建一个对外服务时的入参。 */
export interface DeploymentDraft {
  code: string
  model_version_id: string
  name: string
  description?: string | undefined
  max_rows_per_call?: number | undefined
  rate_limit_per_minute?: number | undefined
}

/** 改一个对外服务时的补丁。缺省的字段不动。 */
export type DeploymentPatch = Partial<DeploymentDraft> & {
  is_enabled?: boolean | undefined
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
    /** 开一个对外服务。 */
    create: async (input: DeploymentDraft) => {
      const done = await run(() => modeling.createModelDeployment(input))
      if (done !== null) toast.success('对外服务已开通')
      return done
    },
    /** 换版本、改配额、启停。 */
    update: async (deploymentId: string, patch: DeploymentPatch) => {
      const done = await run(() =>
        modeling.updateModelDeployment(deploymentId, patch),
      )
      if (done !== null) toast.success('已保存')
      return done
    },
  }
}
