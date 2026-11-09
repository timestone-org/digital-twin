<script setup lang="ts">
/**
 * @fileoverview 素材挑选弹窗：按类型浏览、搜索、翻页，持 asset:manage 时可上传；
 * 选中回一个 `asset:` 引用。删除只在素材库页做：这里手一滑删掉的是所有大屏共用的那份字节。
 * ⚠ 回的是引用不是 URL：URL 在下一次部署就可能 404，而存进大屏配置之后没有
 * 任何一处会报错——表现只是那张屏上的模型不见了。
 */
import type { AssetKind } from '@dt/contracts'
import { assetUrl, PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtEmpty,
  DtFilePicker,
  DtIcon,
  DtInput,
  DtModal,
  DtNotice,
  DtSpinner,
} from '@dt/ui'
import { getActivePinia } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'

import type { Asset } from '@/api/assets'
import { ASSET_BASE_URL } from '@/config/app'
import { useAuthStore } from '@/stores/auth'
import { useAssetLibrary } from '@/features/assets/useAssetLibrary'
import { formatDay } from '@/utils/datetime'
import { formatSize } from '@/utils/filesize'

const props = defineProps<{
  modelValue: boolean
  /** 只挑这一类。⚠ 不给「全部」：挑模型的地方选到一张图片是配错而不是自由 */
  kind: AssetKind
  title?: string
  /** 当前已选的 `asset:` 引用；打开时预选它，原样点「选用」就是不改。 */
  current?: string | undefined
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  pick: [ref: string, asset: Asset]
}>()

/** 敲字停下多久才搜。 */
const SEARCH_DEBOUNCE_MS = 300

const library = useAssetLibrary()
const selectedId = ref('')
const draftKeyword = ref('')
// 没有 pinia（嵌在只测挑选的宿主里）时按无权处理：只藏写入口，不影响挑选
const canManage = computed(
  () =>
    getActivePinia() !== undefined &&
    useAuthStore().can([PERMISSION_CODES.assetManage]),
)
let debounce: ReturnType<typeof setTimeout> | null = null

function stopDebounce(): void {
  if (debounce !== null) clearTimeout(debounce)
  debounce = null
}

// ⚠ 只列第一页的话，超过 50 条时最旧的那几条在这里永远挑不到
function typeKeyword(text: string): void {
  draftKeyword.value = text
  stopDebounce()
  debounce = setTimeout(() => {
    debounce = null
    void library.search(text)
  }, SEARCH_DEBOUNCE_MS)
}

onUnmounted(stopDebounce)
const dialogTitle = computed(() => props.title ?? '选择素材')

const accept = computed(() => library.spec.value?.contentTypes.join(',') ?? '')
const maxLabel = computed(() => {
  const bytes = library.spec.value?.maxBytes ?? 0
  return bytes === 0 ? '' : `单个文件最大 ${formatSize(bytes)}`
})

const selected = computed<Asset | null>(
  () =>
    library.assets.value.find((item) => item.id === selectedId.value) ?? null,
)

function close(): void {
  // 关窗即中止在途上传：不中止的话它会传完再往一个已经关掉的界面写状态
  library.abort()
  emit('update:modelValue', false)
}

function pickSelected(): void {
  const asset = selected.value
  if (asset === null) return
  emit('pick', asset.ref, asset)
  close()
}

// 读不出来的缩略图换回占位图标：碎图看着像页面坏了
const brokenThumbs = ref<ReadonlySet<string>>(new Set())

/**
 * 列表行的缩略图地址；模型不给。
 * ⚠ 模型不在列表里开 WebGL：一行一个上下文，五十行就把浏览器的上下文配额用光。
 * @param asset 一条素材
 */
function thumbOf(asset: Asset): string {
  return asset.kind === 'model' || brokenThumbs.value.has(asset.id)
    ? ''
    : assetUrl(ASSET_BASE_URL, asset.kind, asset.ref)
}

function markBroken(id: string): void {
  brokenThumbs.value = new Set([...brokenThumbs.value, id])
}

function pickNow(asset: Asset): void {
  selectedId.value = asset.id
  pickSelected()
}

async function onFiles(files: File[]): Promise<void> {
  const file = files[0]
  if (file === undefined) return
  const [saved] = await library.upload(props.kind, [file])
  // 传完即选中：用户刚挑的文件就是他要用的那个，再让他去列表里找一遍是白费
  if (saved !== undefined) selectedId.value = saved.id
}

/** 列表到了再预选当前引用；用户已经点了别的就不抢。 */
function preselect(): void {
  if (selectedId.value !== '' || props.current === undefined) return
  const found = library.assets.value.find((item) => item.ref === props.current)
  if (found !== undefined) selectedId.value = found.id
}

watch(
  () => [props.modelValue, props.kind] as const,
  ([open, kind]) => {
    if (!open) return
    selectedId.value = ''
    draftKeyword.value = ''
    brokenThumbs.value = new Set()
    stopDebounce()
    // ⚠ 关键词跟着搜索框一起清：只清框的话，上一次的词还在库里筛着列表
    library.keyword.value = ''
    void library.reload(kind).then(preselect)
  },
  { immediate: true },
)
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="dialogTitle"
    :description="maxLabel"
    width="46rem"
    @update:model-value="close"
  >
    <div class="dt-assets">
      <div class="dt-assets__bar">
        <DtInput
          :model-value="draftKeyword"
          type="search"
          size="sm"
          class="flex-1"
          placeholder="按名字搜索"
          aria-label="按名字搜索素材"
          @update:model-value="typeKeyword"
        />
        <DtFilePicker
          v-if="canManage"
          :accept="accept"
          :disabled="library.isUploading.value"
          label="上传素材"
          size="sm"
          @select="onFiles"
        />
        <DtSpinner v-if="library.isUploading.value" />
        <span v-if="library.isUploading.value" class="dt-assets__hint">
          上传中，关闭窗口会中止
        </span>
      </div>

      <DtNotice v-if="library.error.value !== ''" intent="danger">
        {{ library.error.value }}
      </DtNotice>

      <div v-if="library.isLoading.value" class="dt-assets__center">
        <DtSpinner />
      </div>
      <DtEmpty
        v-else-if="
          library.assets.value.length === 0 && library.keyword.value !== ''
        "
        icon="search"
        title="没搜着"
        hint="换个关键词试试"
      />
      <DtEmpty
        v-else-if="library.assets.value.length === 0"
        icon="image"
        title="还没有素材"
        hint="点上方按钮传一个"
      />
      <ul v-else class="dt-assets__list">
        <li v-for="asset in library.assets.value" :key="asset.id">
          <button
            type="button"
            class="dt-assets__item"
            :class="{ 'is-active': asset.id === selectedId }"
            :aria-current="asset.id === selectedId ? 'true' : undefined"
            @click="selectedId = asset.id"
            @dblclick="pickNow(asset)"
          >
            <span class="dt-assets__thumb">
              <!-- alt 留空：名字就在同一行，读屏再念一遍只是噪音 -->
              <img
                v-if="thumbOf(asset) !== ''"
                :src="thumbOf(asset)"
                alt=""
                loading="lazy"
                @error="markBroken(asset.id)"
              />
              <DtIcon v-else name="layers" :size="14" />
            </span>
            <span class="dt-assets__name" :title="asset.name">{{
              asset.name
            }}</span>
            <span class="dt-assets__meta">
              {{ formatSize(asset.sizeBytes) }} ·
              {{ formatDay(asset.createdAt) }}
            </span>
          </button>
        </li>
      </ul>
      <div v-if="library.hasMore.value" class="dt-assets__more">
        <DtButton
          size="sm"
          variant="ghost"
          :disabled="library.isLoading.value"
          @click="library.loadMore()"
        >
          加载更多
        </DtButton>
      </div>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="close">取消</DtButton>
      <DtButton :disabled="selected === null" @click="pickSelected"
        >选用</DtButton
      >
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-assets {
  display: flex;
  min-height: 18rem;
  flex-direction: column;
  gap: 12px;

  &__bar {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__hint {
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }

  &__more {
    display: flex;
    justify-content: center;
  }

  &__center {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
  }

  &__list {
    display: flex;
    max-height: 24rem;
    flex-direction: column;
    padding: 0;
    margin: 0;
    gap: 4px;
    list-style: none;
    overflow-y: auto;

    li {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  }

  &__item {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    gap: 12px;
    text-align: left;

    &:hover {
      border-color: var(--border-hover);
    }

    &.is-active {
      border-color: var(--accent-primary);
      background: rgba(var(--accent-primary-rgb), 0.08);
    }
  }

  &__thumb {
    display: inline-flex;
    width: 2rem;
    height: 2rem;
    flex: none;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-disabled);
    overflow: hidden;

    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  }

  &__name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    flex: none;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }
}
</style>
