/** @fileoverview 详情开着且有档在压缩时轮询这一个素材，压好就替换详情与列表那一行。 */
import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/api/assets'
import type { Asset } from '@/api/assets'
import { useVariantPolling } from '@/pages/Assets/scripts/useVariantPolling'

function asset(status: 'pending' | 'ready'): Asset {
  return {
    id: 'm1',
    ref: 'asset:m1',
    kind: 'model',
    name: 'cube.glb',
    contentType: 'model/gltf-binary',
    sizeBytes: 10,
    checksum: 'x',
    createdAt: '2026-08-15T00:00:00.000Z',
    createdBy: 'me',
    variants: [
      {
        variant: 'high',
        label: '高',
        hint: '',
        status,
        sizeBytes: status === 'ready' ? 5 : null,
        checksum: null,
        error: '',
      },
    ],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useVariantPolling', () => {
  it('压好之后替换详情与列表那一行，然后停下', async () => {
    const read = vi.spyOn(api, 'getAsset').mockResolvedValue(asset('ready'))
    const detail = ref<Asset | null>(asset('pending'))
    const rows = ref<readonly Asset[]>([asset('pending')])
    const scope = effectScope()
    scope.run(() => useVariantPolling(detail, rows))

    await vi.advanceTimersByTimeAsync(5_000)
    expect(read).toHaveBeenCalledWith('m1', expect.any(AbortSignal))
    expect(detail.value?.variants[0]?.status).toBe('ready')
    expect(rows.value[0]?.variants[0]?.status).toBe('ready')

    await vi.advanceTimersByTimeAsync(20_000)
    expect(read).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('详情关掉就不再问', async () => {
    const read = vi.spyOn(api, 'getAsset').mockResolvedValue(asset('pending'))
    const detail = ref<Asset | null>(asset('pending'))
    const scope = effectScope()
    scope.run(() => useVariantPolling(detail, ref([])))
    detail.value = null
    await vi.advanceTimersByTimeAsync(20_000)
    expect(read).not.toHaveBeenCalled()
    scope.stop()
  })
})
