/**
 * @fileoverview 素材库页的交互编排：切类型、搜索防抖、开详情。
 *
 * 从 `index.vue` 抽出来是为了让那份单文件组件只剩呈现；库状态本身在
 * `features/assets/useAssetLibrary.ts`，纯呈现派生在 `assetsView.ts`，
 * 按一下就发生一件事的那几个动作在 `assetsActions.ts`。
 */
import { PERMISSION_CODES } from '@dt/contracts'
import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { Asset } from '@/api/assets'
import { useAssetLibrary } from '@/features/assets/useAssetLibrary'
import type { AssetLibrary } from '@/features/assets/useAssetLibrary'
import { useAuthStore } from '@/stores/auth'
import { createAssetsActions } from './assetsActions'
import type { AssetsActions } from './assetsActions'
import { createAssetsView } from './assetsView'
import { useAssetFilters, type AssetFilters } from './useAssetFilters'
import { useVariantPolling } from './useVariantPolling'
import type { AssetsView } from './assetsView'

export interface AssetsPage extends AssetsView, AssetsActions, AssetFilters {
  library: AssetLibrary
  /** 正在看详情的素材；关着时为 null。 */
  detail: Ref<Asset | null>
  canManage: ComputedRef<boolean>
  addFiles: (files: File[]) => Promise<void>
  openDetail: (row: Asset) => void
  closeDetail: () => void
}

/** 装一页素材库。 */
export function useAssetsPage(): AssetsPage {
  const auth = useAuthStore()
  const library = useAssetLibrary()

  const filters = useAssetFilters(library)
  const { kind } = filters
  const detail = ref<Asset | null>(null)
  const actions = createAssetsActions(library, detail)
  useVariantPolling(detail, library.assets)

  async function addFiles(files: File[]): Promise<void> {
    const saved = await library.upload(kind.value, files)
    if (saved.length > 0) actions.announce(`已上传 ${saved.length} 个素材`)
  }

  return {
    library,
    ...filters,
    detail,
    canManage: computed(() => auth.can([PERMISSION_CODES.assetManage])),
    addFiles,
    openDetail: (row) => (detail.value = row),
    closeDetail: () => (detail.value = null),
    ...createAssetsView(library, kind),
    ...actions,
  }
}
