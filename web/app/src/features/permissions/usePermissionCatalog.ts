/**
 * @fileoverview 权限目录的共享取数。目录是种子驱动的静态数据，全应用取一次。
 */

import { ref, type Ref } from 'vue'
import type { PermissionGroup } from '@dt/contracts'

import { fetchPermissionCatalog } from '@/api/auth'
import { describeError } from '@/composables/useAsyncList'

const groups = ref<PermissionGroup[]>([])
const error = ref<string | null>(null)
// ⚠ 缓存的是**进行中的 Promise** 而不是「取过了」的布尔：三个弹窗同一帧打开时，
// 布尔标记挡不住并发的三次请求，它们都会看到「还没取过」。
let inFlight: Promise<void> | null = null

interface Catalog {
  groups: Ref<PermissionGroup[]>
  error: Ref<string | null>
  ensure: () => Promise<void>
}

export function usePermissionCatalog(): Catalog {
  async function ensure(): Promise<void> {
    if (groups.value.length > 0) return
    inFlight ??= fetchPermissionCatalog()
      .then((catalog) => {
        groups.value = catalog.groups
        error.value = null
      })
      .catch((caught: unknown) => {
        error.value = describeError(caught)
      })
      .finally(() => {
        inFlight = null
      })
    await inFlight
  }

  return { groups, error, ensure }
}

/** 仅供测试：清掉模块级缓存，否则用例之间会互相看到对方的数据。 */
export function __resetPermissionCatalog(): void {
  groups.value = []
  error.value = null
  inFlight = null
}
