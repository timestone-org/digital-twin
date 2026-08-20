/**
 * @fileoverview 素材库页上按一下就发生一件事的那几个动作：复制引用、下载原件、
 * 改名、删除，以及它们在详情面上的无参版本。
 *
 * 从 `useAssetsPage.ts` 分出来是为了把那个组合式压回 50 行的函数上限。
 */
import { assetUrl } from '@dt/contracts'
import { useConfirm, useToast } from '@dt/ui'
import type { Ref } from 'vue'

import type { Asset } from '@/api/assets'
import { ASSET_BASE_URL } from '@/config/app'
import type { AssetLibrary } from '@/features/assets/useAssetLibrary'
import { copyText } from '@/utils/clipboard'
import { downloadUrl } from '@/utils/downloadJson'

export interface AssetsActions {
  copyRef: (row: Asset) => Promise<void>
  download: (row: Asset) => void
  rename: (name: string) => Promise<void>
  remove: (row: Asset) => Promise<void>
  /** 详情面上的三个动作，落在当前正看的那一个上。 */
  copyDetail: () => void
  downloadDetail: () => void
  removeDetail: () => void
  /** 报一句成功。上传那一段也用它，免得两处各拿一个 toast。 */
  announce: (message: string) => void
}

/**
 * 装上这一页的动作。
 * @param library 素材库状态
 * @param detail 当前正看详情的素材
 */
export function createAssetsActions(
  library: AssetLibrary,
  detail: Ref<Asset | null>,
): AssetsActions {
  const toast = useToast()
  const confirm = useConfirm()

  async function copyRef(row: Asset): Promise<void> {
    if (await copyText(row.ref)) toast.success('引用已复制')
    else toast.error('复制失败，请手动选中')
  }

  function download(row: Asset): void {
    downloadUrl(assetUrl(ASSET_BASE_URL, row.kind, row.ref), row.name)
  }

  async function rename(name: string): Promise<void> {
    const target = detail.value
    if (target === null) return
    if (!(await library.rename(target.id, name))) return
    // 详情面上的那份也要换掉：不换的话标题与元信息还停在旧名字上
    detail.value = { ...target, name }
    toast.success('已改名')
  }

  async function remove(row: Asset): Promise<void> {
    if (!(await askToDelete(confirm, row))) return
    await library.remove(row.id)
    if (library.error.value !== '') return
    // 删掉之后详情面必须跟着关：留着的话它显示的是一个已经不存在的素材
    if (detail.value?.id === row.id) detail.value = null
    toast.success('素材已删除')
  }

  /**
   * 把一个按行的动作包成「作用在当前详情上」的无参回调。
   * ⚠ 包一层而不是让模板写 `detail && act(detail)`：模板里的那种写法在
   * `detail` 为 null 时求值成 null，看着像什么都没做，实际是**表达式的值**
   * 被当成了事件处理器的返回值——真出问题时一句报错都没有。
   * @param act 按行的动作
   */
  function onDetail(act: (row: Asset) => unknown): () => void {
    return () => {
      const row = detail.value
      if (row !== null) void act(row)
    }
  }

  return {
    copyRef,
    download,
    rename,
    remove,
    copyDetail: onDetail(copyRef),
    downloadDetail: onDetail(download),
    removeDetail: onDetail(remove),
    announce: (message) => toast.success(message),
  }
}

/**
 * 删素材的二次确认。
 * ⚠ 措辞里必须写清「不检查有没有人在用」：删除刻意不扫配置（引用可出现在任意
 * 嵌套层），引用它的大屏只会显示「取不到」，不会有任何一处报错。
 * @param confirm 确认框
 * @param row 要删的素材
 */
function askToDelete(
  confirm: ReturnType<typeof useConfirm>,
  row: Asset,
): Promise<boolean> {
  return confirm.ask({
    title: '删除素材',
    message:
      `「${row.name}」的字节会一并删掉，不可恢复。⚠ 删除不检查有没有人在用：` +
      '正在引用它的大屏会显示「取不到」，而不会有任何一处报错。',
    confirmText: '删除',
    danger: true,
  })
}
