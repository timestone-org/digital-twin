/**
 * @fileoverview 实例上的写动作：建、改、起停、删。页面只管摆，编排收在这里。
 *
 * ⚠ 停与重启必须先确认，且文案要说清「上面 N 个上位机会话会全部断开」：这一步
 * 断的是别人的连接，只有发起的人看得见后果，被断的那几台上位机什么提示都没有。
 * ⚠ 改完要如实报「哪些字段没立刻生效」：端口一类的改动要重启才吃得到，报一句
 * 「已保存」会让人以为现在连的就是新端口。
 * ⚠ 每个动作都是模块级函数、只收一份 `deps`：写在 composable 里会让它涨成一个
 * 谁也不敢动的大函数，而这几件事彼此并不相关。
 */
import { useConfirm, useToast } from '@dt/ui'
import { ref, type Ref } from 'vue'
import type { OpcuaInstance } from '@dt/contracts'

import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'

import { pendingSummary } from './pendingFields'

export type InstanceVerb = 'start' | 'stop' | 'restart'

const VERB_DONE: Record<InstanceVerb, string> = {
  start: '实例已启动',
  stop: '实例已停止',
  restart: '实例已重启',
}

interface Deps {
  toast: ReturnType<typeof useToast>
  confirm: ReturnType<typeof useConfirm>
  reload: () => Promise<void>
  formOpen: Ref<boolean>
  editing: Ref<OpcuaInstance | null>
}

export interface InstanceOps {
  formOpen: Ref<boolean>
  editing: Ref<OpcuaInstance | null>
  openCreate: () => void
  openEdit: (instance: OpcuaInstance) => void
  create: (input: Parameters<typeof opcua.createInstance>[0]) => Promise<void>
  update: (input: Parameters<typeof opcua.updateInstance>[1]) => Promise<void>
  act: (instance: OpcuaInstance, verb: InstanceVerb) => Promise<void>
  remove: (instance: OpcuaInstance) => Promise<void>
}

/** 跑一次写动作，失败只吐一条原因——写失败不该把整页带走。 */
async function guarded(deps: Deps, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (caught) {
    deps.toast.error(describeError(caught))
  }
}

async function afterWrite(deps: Deps, message: string): Promise<void> {
  deps.formOpen.value = false
  deps.toast.success(message)
  await deps.reload()
}

async function create(
  deps: Deps,
  input: Parameters<typeof opcua.createInstance>[0],
): Promise<void> {
  await guarded(deps, async () => {
    await opcua.createInstance(input)
    await afterWrite(deps, '实例已创建')
  })
}

async function update(
  deps: Deps,
  input: Parameters<typeof opcua.updateInstance>[1],
): Promise<void> {
  const target = deps.editing.value
  if (target === null) return
  await guarded(deps, async () => {
    const saved = await opcua.updateInstance(target.id, input)
    await afterWrite(
      deps,
      saved.pending_fields.length > 0
        ? pendingSummary(saved.pending_fields)
        : '实例已保存',
    )
  })
}

async function act(
  deps: Deps,
  instance: OpcuaInstance,
  verb: InstanceVerb,
): Promise<void> {
  if (verb !== 'start') {
    const ok = await deps.confirm.ask({
      title: verb === 'stop' ? '停止实例' : '重启实例',
      message:
        `「${instance.name}」上当前有 ${instance.session_count} 个上位机会话，` +
        '这些连接会全部断开，需要对方自行重连。',
      confirmText: verb === 'stop' ? '停止' : '重启',
      danger: true,
    })
    if (!ok) return
  }
  await guarded(deps, async () => {
    await opcua.actOnInstance(instance.id, verb)
    deps.toast.success(VERB_DONE[verb])
    await deps.reload()
  })
}

async function remove(deps: Deps, instance: OpcuaInstance): Promise<void> {
  const ok = await deps.confirm.ask({
    title: '删除实例',
    message:
      `删除「${instance.name}」会一并删掉它的 ${instance.node_count} 个节点、` +
      '接入凭据与信任证书，且端口会退回池中。此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await guarded(deps, async () => {
    await opcua.deleteInstance(instance.id)
    deps.toast.success('实例已删除')
    await deps.reload()
  })
}

/**
 * 装上实例的写动作。
 * @param reload 写成功后重取列表
 */
export function useInstanceOps(reload: () => Promise<void>): InstanceOps {
  const formOpen = ref(false)
  const editing = ref<OpcuaInstance | null>(null)
  const deps: Deps = {
    toast: useToast(),
    confirm: useConfirm(),
    reload,
    formOpen,
    editing,
  }
  return {
    formOpen,
    editing,
    openCreate: () => {
      editing.value = null
      formOpen.value = true
    },
    openEdit: (instance) => {
      editing.value = instance
      formOpen.value = true
    },
    create: (input) => create(deps, input),
    update: (input) => update(deps, input),
    act: (instance, verb) => act(deps, instance, verb),
    remove: (instance) => remove(deps, instance),
  }
}
