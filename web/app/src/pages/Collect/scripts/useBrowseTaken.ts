/** @fileoverview 浏览器已建点位索引的分页读取与切源取消。 */
import { onBeforeUnmount, ref } from 'vue'

import * as collect from '@/api/collect'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

const SCAN_PAGE_SIZE = 100

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
  const addresses = new Set<string>()
  const codes = new Set<string>()
  let page = 1
  while (!signal.aborted) {
    const chunk = await collect.listPoints(
      { sourceId, page, size: SCAN_PAGE_SIZE },
      signal,
    )
    for (const point of chunk.items) {
      addresses.add(point.address)
      codes.add(point.code)
    }
    if (codes.size >= chunk.total || chunk.items.length === 0) break
    page += 1
  }
  return { addresses, codes }
}
