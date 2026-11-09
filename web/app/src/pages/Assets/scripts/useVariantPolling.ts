/**
 * @fileoverview 详情开着且有压缩档还在排队时，隔几秒重读这一个素材，压好了就换上。
 * 没有推送通道，这是「压好会自动出现」唯一兑现的地方。
 */
import { onScopeDispose, watch, type Ref } from 'vue'

import { getAsset, type Asset } from '@/api/assets'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 轮询间隔。压一档通常要十几秒，再密只是白打请求。 */
const POLL_INTERVAL_MS = 5_000

function hasPending(asset: Asset | null): asset is Asset {
  return asset?.variants.some((item) => item.status === 'pending') === true
}

/**
 * @param detail 正在看详情的素材
 * @param rows 列表里已摊开的那些行；读回来的新值按 id 换掉其中那一行
 */
export function useVariantPolling(
  detail: Ref<Asset | null>,
  rows: Ref<readonly Asset[]>,
): void {
  const raced = useRacedFetch()
  let timer: ReturnType<typeof setTimeout> | null = null

  function stop(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    raced.cancel()
  }

  function accept(fresh: Asset): void {
    rows.value = rows.value.map((item) => (item.id === fresh.id ? fresh : item))
    if (detail.value?.id === fresh.id) detail.value = fresh
  }

  function schedule(assetId: string): void {
    timer = setTimeout(() => {
      timer = null
      void raced.run((signal) => getAsset(assetId, signal), {
        ok: accept,
        fail: () => undefined,
        settled: () => {
          if (timer === null && hasPending(detail.value)) {
            schedule(detail.value.id)
          }
        },
      })
    }, POLL_INTERVAL_MS)
  }

  watch(
    () => (hasPending(detail.value) ? detail.value.id : null),
    (assetId) => {
      stop()
      if (assetId !== null) schedule(assetId)
    },
    { immediate: true },
  )

  onScopeDispose(stop)
}
