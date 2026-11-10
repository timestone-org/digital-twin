/**
 * @fileoverview 实例起停：确认、在途守卫与结果提示，列表页与详情页共用一份。
 *
 * ⚠ 停与重启必须先确认，且文案要说清「上面 N 个上位机会话会全部断开」：这一步
 * 断的是别人的连接，只有发起的人看得见后果。
 */
import { useConfirm, useToast } from '@dt/ui'
import { ref, type Ref } from 'vue'
import type { OpcuaInstance } from '@dt/contracts'

import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'

export type InstanceVerb = 'start' | 'stop' | 'restart'

const VERB_DONE: Record<InstanceVerb, string> = {
  start: '实例已启动',
  stop: '实例已停止',
  restart: '实例已重启',
}

export interface InstanceActions {
  /** 有起停在途（含等确认）；在途时再点不重复下发。 */
  pending: Ref<boolean>
  act: (instance: OpcuaInstance, verb: InstanceVerb) => Promise<void>
}

/**
 * 装上实例起停。
 * @param reload 动作成功后重取
 */
export function useInstanceActions(
  reload: () => Promise<void>,
): InstanceActions {
  const toast = useToast()
  const confirm = useConfirm()
  const pending = ref(false)

  async function ask(instance: OpcuaInstance, verb: InstanceVerb) {
    if (verb === 'start') return true
    return confirm.ask({
      title: verb === 'stop' ? '停止实例' : '重启实例',
      message:
        `「${instance.name}」上当前有 ${instance.session_count} 个上位机会话，` +
        '这些连接会全部断开，需要对方自行重连。',
      confirmText: verb === 'stop' ? '停止' : '重启',
      danger: true,
    })
  }

  async function act(instance: OpcuaInstance, verb: InstanceVerb) {
    if (pending.value) return
    pending.value = true
    try {
      if (!(await ask(instance, verb))) return
      await opcua.actOnInstance(instance.id, verb)
      toast.success(VERB_DONE[verb])
      await reload()
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      pending.value = false
    }
  }

  return { pending, act }
}
