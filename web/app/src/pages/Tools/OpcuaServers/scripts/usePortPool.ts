/**
 * @fileoverview 新建实例时能挑哪个端口：拉一次端口池，给出可选项与默认选中。
 *
 * ⚠ 池子空了要能说出来：此时连「指定端口」这一档都不该给——摆着一个选了也
 * 没得填的选项，用户会以为是自己没找对地方。
 * ⚠ 取不到池子不等于不能建实例：自动分配那一档照常可用，所以失败只记一条
 * 原因交给界面显示，不往上抛。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { DtSelectOption, OpcuaPortPool } from '@dt/contracts'

import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'

export interface PortPool {
  /** 池子本身（容量、已用、上限）；还没拉到时为 null。 */
  current: Ref<OpcuaPortPool | null>
  /** 可选端口，空数组表示池子里没有空位。 */
  options: ComputedRef<DtSelectOption[]>
  /** 有没有端口可挑。 */
  canPick: ComputedRef<boolean>
  /** 取池子失败的原因；成功为 null。 */
  error: Ref<string | null>
  /** 拉一次池子，并把 `port` 落在第一个空位上。 */
  load: (port: Ref<string>) => Promise<void>
}

/** 装上端口池取数。构造时不发请求，由调用方在打开弹窗时拉。 */
export function usePortPool(): PortPool {
  const pool = ref<OpcuaPortPool | null>(null)
  const error = ref<string | null>(null)

  const options = computed<DtSelectOption[]>(() =>
    (pool.value?.free_ports ?? []).map((value) => ({
      value: String(value),
      label: String(value),
    })),
  )

  async function load(port: Ref<string>): Promise<void> {
    try {
      pool.value = await opcua.getPortPool()
      error.value = null
      // 池子拿回来之后给一个默认选中项，省掉「切到指定端口却是空的」这一步
      port.value = pool.value.free_ports[0]?.toString() ?? ''
    } catch (caught) {
      pool.value = null
      error.value = describeError(caught)
    }
  }

  return {
    current: pool,
    options,
    canPick: computed(() => options.value.length > 0),
    error,
    load,
  }
}
