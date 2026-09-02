<script setup lang="ts">
/**
 * @fileoverview 素材库：按类型与名字浏览，上传、预览、改名、下载、删除大屏与
 * 孪生共用的字节。
 *
 * ⚠ 字节从不经过本站 API：上传是浏览器凭签好的表单直传对象存储，预览与取回
 * 走边缘反代的 `/oss/`（ADR-0015）。这一页只管那张表与那几个按钮。
 * ⚠ 「复制」给的是 `asset:<uuid>` 引用而不是 URL：配置里落 URL 的话，部署
 * 地址或桶名一换，存量大屏里那条链接就 404，而没有任何一处会报错。
 * ⚠ 删除**不做引用检查**：逐一扫描配置 JSON 既慢又不完整（引用可出现在任意
 * 嵌套层），故二次确认里必须把「用它的大屏会显示取不到」说清楚。
 * 交互编排在 `scripts/useAssetsPage.ts`，库状态在 `features/assets/`。
 */
import { onMounted } from 'vue'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DtDataColumn } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtFilePicker,
  DtInput,
  DtNotice,
  DtSegmented,
} from '@dt/ui'

import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { formatSize } from '@/utils/filesize'
import AssetDetailDialog from './components/AssetDetailDialog.vue'
import AssetPreview from './components/AssetPreview.vue'
import AssetUploadPanel from './components/AssetUploadPanel.vue'
import { useAssetsPage } from './scripts/useAssetsPage'

/**
 * ⚠ 内容类型与校验和刻意不列在表里：它们把表撑得比视口还宽，而最右边正是
 * 「操作」那一列——按钮在 DOM 里、点得到，用户却要横向拖才看得见，表现就是
 * 「这个页面只能上传」。两样都在详情面里。
 */
const COLUMNS: readonly DtDataColumn[] = [
  { key: 'preview', label: '预览', width: '5rem', card: 'meta' },
  { key: 'name', label: '名称', card: 'title' },
  { key: 'size', label: '大小', width: '7rem', align: 'right' },
  { key: 'createdAt', label: '上传时间', width: '12rem' },
  { key: 'createdBy', label: '上传人', width: '8rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '10rem',
    card: 'actions',
  },
]

const view = useViewMode('assets')
const page = useAssetsPage()
const library = page.library

onMounted(() => void library.reload(page.kind.value))
</script>

<template>
  <AppShell title="素材库" subtitle="大屏与孪生共用的图片、图标与三维模型">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.assetManage]" explain>
        <DtFilePicker
          :accept="page.accept.value"
          multiple
          :disabled="library.isUploading.value"
          :label="library.isUploading.value ? '上传中…' : '上传素材'"
          size="sm"
          @select="page.addFiles"
        />
      </PermGuard>
    </template>

    <!-- h-full + min-h-0：AppShell 的 main 不再滚动，根节点不吃满高度的话
         表格拿不到有界高度，超出的行会被裁掉且滚不到 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="library.error.value !== ''" intent="danger">
        {{ library.error.value }}
      </DtNotice>

      <!-- 素材类型切的是三批互不相干的内容，故用 tabs 档而不是塞进 DtDataView
           的工具条：那格与右侧的视图切换同排居中，页签的底线只横跨工具条自身
           宽度就断掉，看着像画歪了 -->
      <DtSegmented
        :model-value="page.kind.value"
        :options="page.kindOptions.value"
        variant="tabs"
        aria-label="素材类型"
        @update:model-value="page.selectKind"
      />

      <AssetUploadPanel
        :jobs="library.uploads.value"
        :finished="library.finishedUploads.value"
        @cancel="library.abort"
        @clear="library.clearFinishedUploads"
      />

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="library.assets.value"
        :loading="library.isLoading.value"
        :layout="{
          minWidth: '52rem',
          fixedLayout: true,
          cardColumns: 4,
          cardMinWidth: '18rem',
        }"
        :empty="page.empty.value"
      >
        <template #toolbar>
          <DtInput
            :model-value="page.draftKeyword.value"
            type="search"
            size="sm"
            placeholder="按名字搜索"
            aria-label="按名字搜索素材"
            @update:model-value="page.typeKeyword"
          />
        </template>

        <template #summary>
          已加载 {{ library.assets.value.length }} 项{{
            page.maxHint.value === '' ? '' : `・${page.maxHint.value}`
          }}
        </template>

        <template #cell-preview="{ row }">
          <AssetPreview :asset="row" />
        </template>

        <!-- 名字本身就是打开详情的入口：这一格是全表最好点中的目标。
             ⚠ 用 DtButton 而不是自己画一个 `<button>`：手搓的那颗要自带焦点环、
             禁用态与换肤色，而这三样漏哪一样都不报错 -->
        <template #cell-name="{ row }">
          <DtButton
            variant="ghost"
            intent="neutral"
            size="sm"
            class="dt-assets__open"
            @click="page.openDetail(row)"
          >
            {{ row.name }}
          </DtButton>
          <p class="dt-assets__ref">{{ row.ref }}</p>
        </template>

        <template #cell-size="{ row }">{{
          formatSize(row.sizeBytes)
        }}</template>

        <template #cell-createdAt="{ row }">
          {{ formatDateTime(row.createdAt) }}
        </template>

        <template #cell-createdBy="{ row }">{{ row.createdBy }}</template>

        <template #cell-actions="{ row }">
          <DtButton
            variant="ghost"
            size="sm"
            icon="eye"
            aria-label="预览"
            title="预览与详情"
            @click="page.openDetail(row)"
          />
          <DtButton
            variant="ghost"
            size="sm"
            icon="copy"
            aria-label="复制引用"
            title="复制引用"
            @click="page.copyRef(row)"
          />
          <DtButton
            variant="ghost"
            size="sm"
            icon="download"
            aria-label="下载原件"
            title="下载原件"
            @click="page.download(row)"
          />
          <PermGuard :codes="[PERMISSION_CODES.assetManage]">
            <DtButton
              variant="ghost"
              intent="danger"
              size="sm"
              icon="trash"
              aria-label="删除"
              title="删除"
              @click="page.remove(row)"
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

    <AssetDetailDialog
      :model-value="page.detail.value !== null"
      :asset="page.detail.value"
      :can-manage="page.canManage.value"
      :kind-label="page.kindLabel.value"
      :is-recompressing="page.isRecompressing.value"
      @update:model-value="page.closeDetail"
      @recompress="page.recompressDetail"
      @rename="page.rename"
      @copy="page.copyDetail"
      @download="page.downloadDetail"
      @remove="page.removeDetail"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.dt-assets {
  // DtButton 是照按钮的尺寸档排的，塞进表格行要把左右内边距收掉，
  // 否则名字会比同一行的其它列各缩进一截
  &__open {
    max-width: 100%;
    justify-content: flex-start;
    padding-inline: 0;
  }

  // 配置里存的就是这一串，出问题时按它去大屏配置里搜
  &__ref {
    overflow: hidden;
    margin: 0;
    color: var(--text-disabled);
    font-family: var(--font-mono);
    font-size: var(--ctl-hint-fs-md);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
