<script setup lang="ts">
/**
 * @fileoverview 在线浏览：一层层展开设备的地址空间，勾中变量批量导入点位。
 *
 * ⚠ 浏览由**持有会话的采集进程**执行，平台侧不建连接。所以设备没连上时这里
 * 一定是空的，而那不是「这台设备没有点位」——两者必须分开说（ADR-0011）。
 *
 * 树的状态与展开/勾选的口径在 `useBrowseTree`（含按子树批量勾选与三态）；
 * 这里只管呈现与「把勾中的变量导入成点位」。导入前经 ImportNodesDialog
 * 统一设采样间隔与记录历史默认。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { CollectPointItemInput, CollectSource } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCard,
  DtNotice,
  DtPageState,
  DtTag,
  useToast,
  DtIconButton,
} from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import type { ImportDraft } from '../scripts/importDrafts'
import { toDrafts } from '../scripts/importDrafts'
import { importPoints } from '../scripts/pointImport'
import { loadRomanize } from '../scripts/romanize'
import { useBrowseTree } from '../scripts/useBrowseTree'
import { useBrowseTaken } from '../scripts/useBrowseTaken'
import BrowseTreeViewport from './BrowseTreeViewport.vue'
import ImportNodesDialog from './ImportNodesDialog.vue'

const props = defineProps<{ source: CollectSource }>()
const emit = defineEmits<{ imported: [count: number] }>()

const toast = useToast()
const busy = ref(false)
const importOpen = ref(false)
/** 待导入的草稿；编码在弹窗里逐行确认，推不出来的等人填。 */
const pending = ref<ImportDraft[]>([])

const {
  addresses: takenAddresses,
  codes: takenCodes,
  load: loadTaken,
} = useBrowseTaken(() => props.source.id)

const tree = useBrowseTree(() => props.source.id, takenAddresses)

const isOffline = computed(() => props.source.runtime.state !== 'online')
const hasSelection = computed(() => tree.selectedCount.value > 0)

/**
 * 勾一个节点。上层节点勾的是它下面的全部变量。
 *
 * ⚠ 每一种「没勾上」都要说出来：勾了却一个都没选上（空节点、或下面的点位
 * 全建过了）与只勾上一半（采集侧在预算内没走完）是两回事，都不许一声不吭。
 */
async function toggle(address: string): Promise<void> {
  const outcome = await tree.toggle(address)
  if (outcome.error !== null) {
    toast.error(outcome.error)
    return
  }
  if (!outcome.isWhole) {
    toast.warning(
      '这个节点下的地址空间达到本次浏览数量或时间预算，还没走完——已勾上' +
        '读回来的点位，其余可点击「加载更多点位」继续浏览。',
    )
    return
  }
  if (outcome.changed > 0) return
  toast.info(
    outcome.total === 0
      ? '这个节点下面没有可选的点位'
      : '这个节点下面的点位都已经建过了',
  )
}

/**
 * 打开导入弹窗：先把勾选的节点解析成草稿（编码由寻址串推，中文名按拼音推）。
 *
 * ⚠ 拼音字典是按需加载的，故这一步是异步的；加载不动就退回「推不出编码」，
 * 那些行在弹窗里留空等人填，而**不是**把节点丢掉。
 */
async function openImport(): Promise<void> {
  if (tree.selectedCount.value === 0 || busy.value) return
  busy.value = true
  try {
    const romanize = await loadRomanize()
    pending.value = toDrafts(
      [...tree.selected.value],
      tree.index.value,
      takenCodes.value,
      romanize,
    )
  } finally {
    busy.value = false
  }
  if (pending.value.length === 0) return
  importOpen.value = true
}

/** 提交批量导入；成功后清空选择并关闭弹窗，失败逐批提示、不清空方便重试。 */
async function doImport(items: CollectPointItemInput[]): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const outcome = await importPoints(props.source.id, items)
    if (outcome.created > 0) {
      importOpen.value = false
      tree.clear()
      await loadTaken()
      emit('imported', outcome.created)
    }
    for (const failure of outcome.failures) {
      toast.error(`第 ${failure.batch} 批没进去：${failure.message}`)
    }
    if (outcome.unverified > 0) {
      toast.warning(`${outcome.unverified} 条寻址串这次没能到现场确认`)
    }
  } catch (caught) {
    toast.error(describeError(caught))
  } finally {
    busy.value = false
  }
}

// 换源：重拉根层与已建清单（useBrowseTree 的 ctx 按 sourceId 现取，无需重建）
watch(
  () => props.source.id,
  () => {
    importOpen.value = false
    pending.value = []
    tree.clear()
    void tree.loadRoot()
    void loadTaken()
  },
)

onMounted(() => {
  void tree.loadRoot()
  void loadTaken()
})
</script>

<template>
  <DtCard icon="network" title="在线浏览" class="flex min-h-0 flex-col">
    <template #actions>
      <DtTag v-if="hasSelection" size="sm" intent="info">
        已选 {{ tree.selectedCount.value }}
      </DtTag>
      <DtIconButton
        variant="ghost"
        size="sm"
        :loading="tree.loading.value"
        intent="neutral"
        icon="refresh-cw"
        label="刷新"
        @click="tree.loadRoot"
      />
      <!-- 导入写的是点位表，挂 collect:manage；能浏览不等于能落点位 -->
      <PermGuard :codes="[PERMISSION_CODES.collectManage]">
        <DtButton
          size="sm"
          icon="download"
          :disabled="tree.selectedCount.value === 0"
          :loading="busy"
          @click="openImport"
        >
          导入选中 ({{ tree.selectedCount.value }})
        </DtButton>
      </PermGuard>
    </template>

    <div class="flex min-h-0 flex-1 flex-col gap-3">
      <DtNotice v-if="isOffline" intent="warning" icon="alert-triangle">
        这个数据源当前不在采集，地址空间由持有会话的采集进程读取——现在多半浏览
        不出东西。空树的意思是「读不到」，不是「设备没有点位」。
      </DtNotice>

      <DtNotice
        v-if="tree.error.value && tree.roots.value.length > 0"
        intent="danger"
      >
        {{ tree.error.value }}
      </DtNotice>

      <!-- ⚠ 外面这层 div 不能省：DtPageState 渲染的是 fragment，直接挂在它上
           面的 class 会被 Vue 静默丢掉，树区域于是没有高度约束。
           justify-center 只对空态/加载态生效：树自己是 h-full，与右边点位表的空态同高 -->
      <div class="flex min-h-0 flex-1 flex-col justify-center">
        <DtPageState
          :loading="tree.loading.value"
          :error="tree.roots.value.length === 0 ? tree.error.value : null"
          :empty="
            !tree.loading.value &&
            tree.error.value === null &&
            tree.roots.value.length === 0 &&
            tree.nextToken.value === null
          "
          empty-title="未发现可浏览节点"
          empty-hint="设备没连上时这里一定是空的，先点「连接」并做一次连通性测试。"
          @retry="tree.loadRoot"
        >
          <BrowseTreeViewport
            :roots="tree.roots.value"
            :next-token="tree.nextToken.value"
            :loading-more="tree.loadingMore.value"
            :states="tree.states"
            :taken="takenAddresses"
            @expand="tree.expand"
            @toggle="toggle"
            @load-more="tree.loadMore"
          />
        </DtPageState>
      </div>
    </div>

    <ImportNodesDialog
      v-model="importOpen"
      :drafts="pending"
      :taken-codes="takenCodes"
      :loading="busy"
      @confirm="doImport"
    />
  </DtCard>
</template>
