/**
 * @fileoverview 对外服务面上的动作：开服务、改配额、启停、删；铸与撤销密钥。
 *
 * ⚠ 铸出来那把钥匙的明文**只在回执里出现一次**，之后任何接口都取不回来。
 * 这一层把它原样交给调用点，由界面当场摆出来并给「复制」；再往后就只剩前缀了
 * （docs/MODELING_PLATFORM_DESIGN.md D13）。
 * ⚠ 删一个服务之后那个 URL 立刻 404，对方系统会当场报错——这正是要的：
 * 停一段时间再删的话，那段时间里对方以为还通着。
 */
import type { ModelApiKeyMinted, ModelDeployment } from '@dt/contracts'
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
      `这个服务下的 ${deployment.key_count} 把密钥一起失效。` +
      '只是想暂停的话，用「停用」而不是删。',
    confirmText: '删掉',
    danger: true,
  }
}

/** 撤销密钥前的问话。 */
function revokeAsk(name: string): {
  title: string
  message: string
  confirmText: string
  danger: boolean
} {
  return {
    title: `撤销「${name}」？`,
    message:
      '拿着这把钥匙的系统会立刻收到 401。撤销之后没法恢复，只能另发一把。',
    confirmText: '撤销',
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
    if (done !== undefined) toast.success('已删除')
  }

  /** 撤销一把钥匙。立刻生效，没法恢复。 */
  async function revokeKey(
    deploymentId: string,
    keyId: string,
    name: string,
  ): Promise<void> {
    if (!(await confirm.ask(revokeAsk(name)))) return
    const done = await run(() =>
      modeling.revokeModelApiKey(deploymentId, keyId),
    )
    if (done !== null) toast.success('已撤销')
  }

  return {
    isBusy,
    remove,
    revokeKey,
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
    /**
     * 铸一把新钥匙，把明文交回调用点。
     *
     * ⚠ 这里**不 toast 明文**：toast 会自己消失，而这是唯一一次看得到它的机会。
     */
    mintKey: async (
      deploymentId: string,
      input: { name: string; expires_at?: string | undefined },
    ): Promise<ModelApiKeyMinted | null> =>
      await run(() => modeling.createModelApiKey(deploymentId, input)),
  }
}
