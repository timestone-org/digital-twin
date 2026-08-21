/**
 * @fileoverview 素材库页的交互编排：切类型、搜索防抖、开详情。
 *
 * 从 `index.vue` 抽出来是为了把那一份单文件组件压回 300 行的闸；库状态本身在
 * `features/assets/useAssetLibrary.ts`，纯呈现派生在 `assetsView.ts`，
 * 按一下就发生一件事的那几个动作在 `assetsActions.ts`。
 */
import { ASSET_KINDS, PERMISSION_CODES } from '@dt/contracts'
import type { AssetKind } from '@dt/contracts'
import { computed, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { Asset } from '@/api/assets'
import { useAssetLibrary } from '@/features/assets/useAssetLibrary'
import type { AssetLibrary } from '@/features/assets/useAssetLibrary'
import { useAuthStore } from '@/stores/auth'
import { createAssetsActions } from './assetsActions'
import type { AssetsActions } from './assetsActions'
import { createAssetsView } from './assetsView'
import type { AssetsView } from './assetsView'

/** 搜索防抖。⚠ 太短会让每敲一个字都发一次请求，太长会像卡住。 */
const SEARCH_DEBOUNCE_MS = 300

export interface AssetsPage extends AssetsView, AssetsActions {
  library: AssetLibrary
  kind: Ref<AssetKind>
  /** 搜索框里的即时值；真正发出去的是防抖之后的那一次。 */
  draftKeyword: Ref<string>
  /** 正在看详情的素材；关着时为 null。 */
  detail: Ref<Asset | null>
  canManage: ComputedRef<boolean>
  selectKind: (next: string) => void
  typeKeyword: (text: string) => void
  addFiles: (files: File[]) => Promise<void>
  openDetail: (row: Asset) => void
  closeDetail: () => void
}

/** 装一页素材库。 */
export function useAssetsPage(): AssetsPage {
  const auth = useAuthStore()
  const library = useAssetLibrary()

  const kind = ref<AssetKind>('image')
  const draftKeyword = ref('')
  const detail = ref<Asset | null>(null)
  const actions = createAssetsActions(library, detail)
  let debounce: ReturnType<typeof setTimeout> | null = null

  function selectKind(next: string): void {
    // ⚠ 收窄而不是断言：DtSegmented 抛的是 string
    const found = ASSET_KINDS.find((item) => item === next)
    if (found === undefined || found === kind.value) return
    kind.value = found
    void library.reload(found)
  }

  function typeKeyword(text: string): void {
    draftKeyword.value = text
    if (debounce !== null) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = null
      void library.search(text)
    }, SEARCH_DEBOUNCE_MS)
  }

  async function addFiles(files: File[]): Promise<void> {
    const saved = await library.upload(kind.value, files)
    if (saved.length > 0) actions.announce(`已上传 ${saved.length} 个素材`)
  }

  // 防抖的定时器活得比这一帧长，不清的话它会在页面卸载之后回来取一次数
  onUnmounted(() => {
    if (debounce !== null) clearTimeout(debounce)
    debounce = null
  })

  return {
    library,
    kind,
    draftKeyword,
    detail,
    canManage: computed(() => auth.can([PERMISSION_CODES.assetManage])),
    selectKind,
    typeKeyword,
    addFiles,
    openDetail: (row) => (detail.value = row),
    closeDetail: () => (detail.value = null),
    ...createAssetsView(library, kind),
    ...actions,
  }
}
