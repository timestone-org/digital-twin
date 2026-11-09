/** @fileoverview 浏览器已建点位索引的分页读取与切源取消。 */
import { onBeforeUnmount, ref } from 'vue'

import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

import { listAllPoints } from './listAllPoints'

interface TakenPoints {
  addresses: Set<string>
  codes: Set<string>
}

/** 读取当前源的已有点位，旧源响应不写回当前索引。 */
export function useBrowseTaken(sourceId: () => string) {
  const addresses = ref(new Set<string>())
  const codes = ref(new Set<string>())
  /** 已建清单没取到的原因；此时「已建」锁与撞码检查都失效，界面要说出来。 */
  const error = ref<string | null>(null)
  const request = useRacedFetch()

  async function load(): Promise<void> {
    const currentSource = sourceId()
    addresses.value = new Set()
    codes.value = new Set()
    error.value = null
    await request.run((signal) => scanExisting(currentSource, signal), {
      ok: (points) => {
        addresses.value = points.addresses
        codes.value = points.codes
      },
      fail: (caught) => {
        addresses.value = new Set()
        codes.value = new Set()
        error.value = describeError(caught)
      },
      settled: () => {},
    })
  }

  onBeforeUnmount(() => request.cancel())
  return { addresses, codes, error, load }
}

async function scanExisting(
  sourceId: string,
  signal: AbortSignal,
): Promise<TakenPoints> {
  const points = await listAllPoints(sourceId, signal)
  return {
    addresses: new Set(points.map((point) => point.address)),
    codes: new Set(points.map((point) => point.code)),
  }
}
