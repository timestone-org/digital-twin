<script setup lang="ts">
/**
 * @fileoverview 素材库：按类型浏览、上传、删除大屏与孪生共用的字节。
 *
 * ⚠ 字节从不经过本站 API：上传是浏览器凭签好的表单直传对象存储，预览与取回
 * 走边缘反代的 `/oss/`（ADR-0015）。这一页只管那张表与那几个按钮。
 * ⚠ 「复制」给的是 `asset:<uuid>` 引用而不是 URL：配置里落 URL 的话，部署
 * 地址或桶名一换，存量大屏里那条链接就 404，而没有任何一处会报错。
 * ⚠ 删除**不做引用检查**：逐一扫描配置 JSON 既慢又不完整（引用可出现在任意
 * 嵌套层），故二次确认里必须把「用它的大屏会显示取不到」说清楚。
 */
import { computed, onMounted, ref } from 'vue'
import { ASSET_KINDS, PERMISSION_CODES } from '@dt/contracts'
import type { AssetKind, DtDataColumn, DtSegmentedOption } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtFilePicker,
  DtNotice,
  DtSegmented,
  useConfirm,
  useToast,
} from '@dt/ui'

import type { Asset } from '@/api/assets'
import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import { useViewMode } from '@/composables/useViewMode'
import { useAssetLibrary } from '@/features/assets/useAssetLibrary'
import { copyText } from '@/utils/clipboard'
import { formatDateTime } from '@/utils/datetime'
import { formatSize } from '@/utils/filesize'
import AssetPreview from './components/AssetPreview.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'preview', label: '预览', width: '5rem', card: 'meta' },
  { key: 'name', label: '名称', card: 'title' },
  { key: 'size', label: '大小', width: '7rem', align: 'right' },
  { key: 'contentType', label: '内容类型', width: '13rem' },
  { key: 'createdAt', label: '上传时间', width: '12rem' },
  { key: 'createdBy', label: '上传人', width: '8rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '7rem',
    card: 'actions',
  },
]

/** 类型页签的图标。标签取服务端目录，图标是纯呈现，留在前端。 */
const KIND_ICONS: Record<AssetKind, string> = {
  model: 'layers',
  image: 'image',
  icon: 'palette',
}

const toast = useToast()
const confirm = useConfirm()
const view = useViewMode('assets')
const library = useAssetLibrary()
const kind = ref<AssetKind>('image')

const kindOptions = computed<DtSegmentedOption[]>(() =>
  ASSET_KINDS.map((value) => ({
    value,
    // 目录还没回来时先用类型本身顶着，回来之后就是服务端那份中文标签
    label: library.kinds.value.find((s) => s.kind === value)?.label ?? value,
    icon: KIND_ICONS[value],
  })),
)

/** 选文件时的 accept 与大小提示，都来自服务端的类型目录。 */
const accept = computed(() => library.spec.value?.contentTypes.join(',') ?? '')
const maxHint = computed(() => {
  const bytes = library.spec.value?.maxBytes ?? 0
  return bytes === 0 ? '' : `单个文件最大 ${formatSize(bytes)}`
})

/**
 * 切类型。⚠ 收窄而不是断言：DtSegmented 抛的是 string。
 * @param next 页签的值
 */
function onKind(next: string): void {
  const found = ASSET_KINDS.find((item) => item === next)
  if (found === undefined || found === kind.value) return
  kind.value = found
  void library.reload(found)
}

async function onFiles(files: File[]): Promise<void> {
  const file = files[0]
  if (file === undefined) return
  const saved = await library.upload(kind.value, file)
  if (saved !== null) toast.success(`已上传「${saved.name}」`)
}

async function onCopy(row: Asset): Promise<void> {
  if (await copyText(row.ref)) toast.success('引用已复制')
  else toast.error('复制失败，请手动选中')
}

async function onRemove(row: Asset): Promise<void> {
  const ok = await confirm.ask({
    title: '删除素材',
    message:
      `「${row.name}」的字节会一并删掉，不可恢复。⚠ 删除不检查有没有人在用：` +
      '正在引用它的大屏会显示「取不到」，而不会有任何一处报错。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  await library.remove(row.id)
  if (library.error.value === '') toast.success('素材已删除')
}

onMounted(() => void library.reload(kind.value))
</script>

<template>
  <AppShell title="素材库" subtitle="大屏与孪生共用的图片、图标与三维模型">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.assetManage]" explain>
        <DtFilePicker
          :accept="accept"
          :disabled="library.isUploading.value"
          :label="library.isUploading.value ? '上传中…' : '上传素材'"
          size="sm"
          @select="onFiles"
        />
      </PermGuard>
    </template>

    <!-- h-full + min-h-0：AppShell 的 main 不再滚动，根节点不吃满高度的话
         表格拿不到有界高度，超出的行会被裁掉且滚不到 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="library.error.value !== ''" intent="danger">
        {{ library.error.value }}
      </DtNotice>

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="library.assets.value"
        :loading="library.isLoading.value"
        :layout="{ minWidth: '62rem', cardColumns: 3, cardMinWidth: '18rem' }"
        :empty="{
          title: '这一类还没有素材',
          hint: '在右上角传一个。传上来的文件会有一串 asset: 引用，配置里存的就是它',
        }"
      >
        <template #toolbar>
          <DtSegmented
            :model-value="kind"
            :options="kindOptions"
            aria-label="素材类型"
            @update:model-value="onKind"
          />
        </template>

        <template #summary>
          已加载 {{ library.assets.value.length }} 项{{
            maxHint === '' ? '' : `・${maxHint}`
          }}
        </template>

        <template #cell-preview="{ row }">
          <AssetPreview :asset="row" />
        </template>

        <template #cell-name="{ row }">
          <p class="m-0 text-text-primary">{{ row.name }}</p>
          <!-- 配置里存的就是这一串，出问题时按它去大屏配置里搜 -->
          <p class="m-0 font-mono text-2xs text-text-disabled">{{ row.ref }}</p>
        </template>

        <template #cell-size="{ row }">{{
          formatSize(row.sizeBytes)
        }}</template>

        <template #cell-contentType="{ row }">
          <span class="font-mono text-2xs">{{ row.contentType }}</span>
        </template>

        <template #cell-createdAt="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>

        <template #cell-createdBy="{ row }">{{ row.createdBy }}</template>

        <template #cell-actions="{ row }">
          <DtButton
            variant="ghost"
            size="sm"
            icon="copy"
            aria-label="复制引用"
            title="复制引用"
            @click="onCopy(row)"
          />
          <PermGuard :codes="[PERMISSION_CODES.assetManage]">
            <DtButton
              variant="ghost"
              intent="danger"
              size="sm"
              icon="trash"
              aria-label="删除"
              title="删除"
              @click="onRemove(row)"
            />
          </PermGuard>
        </template>
      </DtDataView>

      <!-- 服务端不回总数，故没有分页器只有它。⚠ 不许静默截断：取满一页就
           一定要给出这个入口，否则第 51 个素材在界面上根本不存在 -->
      <div v-if="library.hasMore.value" class="flex shrink-0 justify-center">
        <DtButton
          variant="outline"
          size="sm"
          :disabled="library.isLoading.value"
          @click="library.loadMore()"
        >
          加载更多
        </DtButton>
      </div>
    </div>
  </AppShell>
</template>
