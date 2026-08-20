/**
 * @fileoverview 素材库页的纯呈现派生：类型页签、accept、大小提示与两种空态。
 *
 * 从 `useAssetsPage.ts` 分出来是为了把那个组合式压回 200 行的闸；这里一条状态
 * 都不持有，只把库状态换算成界面上的文案。
 */
import type {
  AssetKind,
  DtDataViewEmpty,
  DtSegmentedOption,
} from '@dt/contracts'
import { ASSET_KINDS } from '@dt/contracts'
import { computed } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { AssetLibrary } from '@/features/assets/useAssetLibrary'
import { formatSize } from '@/utils/filesize'

/** 类型页签的图标。标签取服务端目录，图标是纯呈现，留在前端。 */
const KIND_ICONS: Record<AssetKind, string> = {
  model: 'layers',
  image: 'image',
  icon: 'palette',
}

export interface AssetsView {
  kindOptions: ComputedRef<DtSegmentedOption[]>
  /** 当前类型的中文标签。 */
  kindLabel: ComputedRef<string>
  /** 文件选择器的 accept，来自服务端类型目录。 */
  accept: ComputedRef<string>
  /** 「单个文件最大 X」；目录还没回来时是空串。 */
  maxHint: ComputedRef<string>
  empty: ComputedRef<DtDataViewEmpty>
}

/**
 * 把库状态换算成这一页要显示的文案。
 * @param library 素材库状态
 * @param kind 当前类型
 */
export function createAssetsView(
  library: AssetLibrary,
  kind: Ref<AssetKind>,
): AssetsView {
  const labelOf = (value: AssetKind): string =>
    library.kinds.value.find((item) => item.kind === value)?.label ?? value

  return {
    kindOptions: computed(() =>
      ASSET_KINDS.map((value) => ({
        value,
        // 目录还没回来时先用类型本身顶着，回来之后就是服务端那份中文标签
        label: labelOf(value),
        icon: KIND_ICONS[value],
      })),
    ),
    kindLabel: computed(() => labelOf(kind.value)),
    accept: computed(() => library.spec.value?.contentTypes.join(',') ?? ''),
    maxHint: computed(() => {
      const bytes = library.spec.value?.maxBytes ?? 0
      return bytes === 0 ? '' : `单个文件最大 ${formatSize(bytes)}`
    }),
    // ⚠ 两种空必须分开说：搜不到时还劝人「去传一个」，用户真的会把已经在库里的
    // 那份再传一遍，于是同一个模型有了两条记录、两份字节
    empty: computed<DtDataViewEmpty>(() =>
      library.keyword.value === ''
        ? {
            title: '这一类还没有素材',
            hint: '在右上角传一个。传上来的文件会有一串 asset: 引用，配置里存的就是它',
          }
        : {
            title: `没有名字含「${library.keyword.value}」的素材`,
            hint: '换个词，或清空搜索框看这一类的全部',
          },
    ),
  }
}
