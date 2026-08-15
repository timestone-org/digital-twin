<script setup lang="ts">
/**
 * @fileoverview 素材挑选弹窗：按类型浏览、上传、删除，选中回一个 `asset:` 引用。
 * ⚠ 回的是引用不是 URL：URL 在下一次部署就可能 404，而存进大屏配置之后没有
 * 任何一处会报错——表现只是那张屏上的模型不见了。
 */
import type { AssetKind } from '@dt/contracts'
import {
  DtButton,
  DtEmpty,
  DtFilePicker,
  DtModal,
  DtNotice,
  DtSpinner,
} from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { Asset } from '@/api/assets'
import { useAssetLibrary } from '@/features/assets/useAssetLibrary'
import { formatSize } from '@/utils/filesize'

const props = defineProps<{
  modelValue: boolean
  /** 只挑这一类。⚠ 不给「全部」：挑模型的地方选到一张图片是配错而不是自由 */
  kind: AssetKind
  title?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  pick: [ref: string, asset: Asset]
}>()

const library = useAssetLibrary()
const selectedId = ref('')
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

function confirm(): void {
  const asset = selected.value
  if (asset === null) return
  emit('pick', asset.ref, asset)
  close()
}

async function onFiles(files: File[]): Promise<void> {
  const file = files[0]
  if (file === undefined) return
  const saved = await library.upload(props.kind, file)
  // 传完即选中：用户刚挑的文件就是他要用的那个，再让他去列表里找一遍是白费
  if (saved !== null) selectedId.value = saved.id
}

async function onRemove(assetId: string): Promise<void> {
  await library.remove(assetId)
  if (selectedId.value === assetId) selectedId.value = ''
}

watch(
  () => [props.modelValue, props.kind] as const,
  ([open, kind]) => {
    if (!open) return
    selectedId.value = ''
    void library.reload(kind)
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
        <DtFilePicker
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
            :aria-pressed="asset.id === selectedId"
            @click="selectedId = asset.id"
          >
            <span class="dt-assets__name">{{ asset.name }}</span>
            <span class="dt-assets__meta">{{
              formatSize(asset.sizeBytes)
            }}</span>
          </button>
          <DtButton
            size="sm"
            variant="ghost"
            intent="danger"
            icon="trash"
            :aria-label="`删除 ${asset.name}`"
            @click="onRemove(asset.id)"
          />
        </li>
      </ul>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="close">取消</DtButton>
      <DtButton :disabled="selected === null" @click="confirm">选用</DtButton>
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
    align-items: baseline;
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

  &__name {
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
