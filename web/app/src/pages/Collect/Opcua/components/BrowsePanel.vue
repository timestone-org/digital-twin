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
} from '@dt/ui'

import * as collect from '@/api/collect'
import PermGuard from '@/components/PermGuard.vue'
import { describeError } from '@/composables/useAsyncList'
import { toPointItems } from '../browseTree'
import { importPoints } from '../pointImport'
import { useBrowseTree } from '../useBrowseTree'
import BrowseTreeNode from './BrowseTreeNode.vue'
import ImportNodesDialog from './ImportNodesDialog.vue'

/** 扫已有点位时一次取多少条。⚠ 与后端单页上限对齐。 */
const SCAN_PAGE_SIZE = 100

const props = defineProps<{ source: CollectSource }>()
const emit = defineEmits<{ imported: [count: number] }>()

const toast = useToast()
const busy = ref(false)
const importOpen = ref(false)
/** 经编码去重后待导入的项；推不出编码的节点在开弹窗前已剔除并提示。 */
const pending = ref<CollectPointItemInput[]>([])

/** 库里已经建过点位的寻址串与编码。重复建会以 409 整批被拒。 */
const takenAddresses = ref(new Set<string>())
const takenCodes = ref(new Set<string>())

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
      '这个节点下面的地址空间太大，采集侧在这次请求的时间内没走完——已勾上' +
        '读回来的那些，剩下的请逐层展开再勾。',
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

async function scanExisting(): Promise<void> {
  const addresses = new Set<string>()
  const codes = new Set<string>()
  let page = 1
  for (;;) {
    const chunk = await collect.listPoints({
      sourceId: props.source.id,
      page,
      size: SCAN_PAGE_SIZE,
    })
    for (const point of chunk.items) {
      addresses.add(point.address)
      codes.add(point.code)
    }
    if (codes.size >= chunk.total || chunk.items.length === 0) break
    page += 1
  }
  takenAddresses.value = addresses
  takenCodes.value = codes
}

/** 打开导入弹窗：先把勾选的节点解析成待导入项（编码由寻址串推）。 */
function openImport(): void {
  if (tree.selectedCount.value === 0) return
  const { items, skipped } = toPointItems(
    [...tree.selected.value],
    tree.index.value,
    takenCodes.value,
  )
  if (skipped.length > 0) {
    toast.warning(
      `${skipped.length} 个节点推不出合法编码，已跳过，请到点位表手工添加`,
    )
  }
  if (items.length === 0) return
  pending.value = items
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
      await scanExisting()
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

/** 已有点位取不到不阻断浏览：它只影响「已建」标记与编码去重。 */
async function loadTaken(): Promise<void> {
  try {
    await scanExisting()
  } catch {
    takenAddresses.value = new Set<string>()
    takenCodes.value = new Set<string>()
  }
}

// 换源：重拉根层与已建清单（useBrowseTree 的 ctx 按 sourceId 现取，无需重建）
watch(
  () => props.source.id,
  () => {
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
      <DtButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        :loading="tree.loading.value"
        @click="tree.loadRoot"
      >
        刷新
      </DtButton>
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

      <!-- ⚠ 外面这层 div 不能省：DtPageState 渲染的是 fragment，直接挂在它上
           面的 class 会被 Vue 静默丢掉，树区域于是没有高度约束 -->
      <div class="min-h-0 flex-1">
        <DtPageState
          :loading="tree.loading.value"
          :error="tree.error.value"
          :empty="
            !tree.loading.value &&
            tree.error.value === null &&
            tree.roots.value.length === 0
          "
          empty-title="未发现可浏览节点"
          empty-hint="设备没连上时这里一定是空的，先点「连接」并做一次连通性测试。"
          @retry="tree.loadRoot"
        >
          <ul class="m-0 h-full overflow-auto p-0">
            <BrowseTreeNode
              v-for="node in tree.roots.value"
              :key="node.address"
              :node="node"
              :depth="0"
              :states="tree.states.value"
              :taken="takenAddresses"
              @expand="tree.expand"
              @toggle="toggle"
            />
          </ul>
        </DtPageState>
      </div>
    </div>

    <ImportNodesDialog
      v-model="importOpen"
      :items="pending"
      :loading="busy"
      @confirm="doImport"
    />
  </DtCard>
</template>
