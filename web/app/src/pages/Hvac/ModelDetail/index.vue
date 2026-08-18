<script setup lang="ts">
/**
 * @fileoverview 模型详情：评估、折外总览、按组合分组、逐条对比与实时测试。
 *
 * ⚠ 训练中详情继续显示上一次的评估并挂进度提示——半份/空数据比旧数据危险
 * （AC_MODEL_DESIGN §6）。轮询到终态即停，卸载时清定时器。
 * ⚠ 训练由 busy 转终态那一刻，折外预测被整体换掉：全量与分页两处都要刷新。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AcModel, ModelPrediction } from '@dt/contracts'
import { DtNotice, DtSegmented, DtTag, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import DetailActions from './components/DetailActions.vue'
import MetricsPanel from './components/MetricsPanel.vue'
import PublicationPanel from './components/PublicationPanel.vue'
import LiveTestDialog from './components/LiveTestDialog.vue'
import { useOutOfFold } from './scripts/useOutOfFold'
import { usePublication } from './scripts/usePublication'
import { MODEL_STATUS_VIEW, isModelBusy } from '@/features/hvac/modelView'

// 训练中的刷新间隔；一页逐条对比的行数
const POLL_INTERVAL_MS = 5000
const PREDICTION_PAGE_SIZE = 20

/** 两个页签。⚠ 与下面 `v-if` 的取值逐字一致，写错就是一块空白页。 */
const TAB_METRICS = 'metrics'
const TAB_PUBLICATION = 'publication'
const TABS = [
  { value: TAB_METRICS, label: '评估' },
  { value: TAB_PUBLICATION, label: '点位绑定' },
] as const

const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const modelId = computed(() => String(route.params['modelId'] ?? ''))
const model = ref<AcModel | null>(null)
const error = ref<string | null>(null)
const isLiveTestOpen = ref(false)
const tab = ref<string>(TAB_METRICS)
let pollTimer: ReturnType<typeof setInterval> | null = null

/** 全页唯一的组合过滤；空串 = 全部。组合键是 `+` 拼的，后端要逗号分隔。 */
const setFilter = ref('')

const outOfFold = useOutOfFold(
  () => modelId.value,
  () => setFilter.value,
)

const publication = usePublication(
  () => modelId.value,
  () => model.value,
)

// 页签是懒加载的：不点进去就不去打 opcua-server
watch(tab, (value) => {
  if (value === TAB_PUBLICATION) void publication.load()
})

const predictions = useAsyncList<ModelPrediction>(
  (query) =>
    hvac.listModelPredictions(modelId.value, {
      page: query.page,
      size: query.size,
      ...(setFilter.value === ''
        ? {}
        : { running_set: setFilter.value.split('+').join(',') }),
    }),
  PREDICTION_PAGE_SIZE,
)

// 换过滤条件必须回第一页：旧页码在新过滤下多半是空页
watch(setFilter, () => {
  void predictions.reloadFromFirstPage()
})

const statusView = computed(() =>
  model.value ? MODEL_STATUS_VIEW[model.value.status] : null,
)
/** 一行要说的那件最要紧的事；失败原因单独有 DtNotice，不进这里。 */
const staleNotice = computed(() => {
  if (model.value?.is_batch_stale === true) return '数据已更新，可重训取最新'
  if (model.value?.is_feature_stale === true) {
    return '特征口径已更新，建议重训'
  }
  return null
})
/** 回列表时把房间带回去，选中态才不会丢。 */
const backTo = computed(() =>
  model.value === null
    ? '/hvac/models'
    : `/hvac/models?room=${model.value.room.id}`,
)

onMounted(() => {
  void load()
  void predictions.reload()
  outOfFold.reload()
})

onBeforeUnmount(() => {
  stopPolling()
})

async function load(): Promise<void> {
  try {
    const found = await hvac.getAcModel(modelId.value)
    const wasBusy = model.value ? isModelBusy(model.value) : false
    model.value = found
    error.value = null
    syncPolling(found)
    // 训练刚结束这一刻，折外预测已整体换掉，两处都跟着刷新
    if (wasBusy && !isModelBusy(found)) {
      void predictions.reload()
      outOfFold.reload()
    }
  } catch (caught) {
    error.value = describeError(caught)
  }
}

function syncPolling(found: AcModel): void {
  if (isModelBusy(found) && pollTimer === null) {
    pollTimer = setInterval(() => {
      void load()
    }, POLL_INTERVAL_MS)
  }
  if (!isModelBusy(found)) stopPolling()
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function retrain(): Promise<void> {
  try {
    await hvac.retrainAcModel(modelId.value)
    toast.success('重训已排队')
    await load()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

/** E4 的「去重训」：先关弹窗，再走与头部同一条重训路径。 */
function retrainFromDialog(): void {
  isLiveTestOpen.value = false
  void retrain()
}

async function remove(): Promise<void> {
  const found = model.value
  if (found === null) return
  const accepted = await confirm.ask({
    title: '删除模型',
    message: `「${found.name}」的评估与逐条对比会一并删除，此操作不可恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!accepted) return
  try {
    await hvac.deleteAcModel(modelId.value)
    toast.success('已删除')
    void router.push('/hvac/models')
  } catch (caught) {
    toast.error(describeError(caught))
  }
}
</script>

<template>
  <AppShell
    :title="model?.name ?? '模型详情'"
    :subtitle="
      model ? `${model.workshop.name} · ${model.room.name}` : undefined
    "
    :back-to="backTo"
    back-label="达标预测"
  >
    <template #actions>
      <DetailActions
        :model="model"
        @live-test="isLiveTestOpen = true"
        @retrain="retrain"
        @remove="remove"
      />
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>

      <template v-if="model">
        <div class="flex flex-wrap items-center gap-2">
          <DtTag v-if="statusView" size="sm" :intent="statusView.intent">
            {{ statusView.label }}
          </DtTag>
          <span v-if="isModelBusy(model)" class="text-xs text-text-secondary">
            训练大约几十秒；期间显示的是上一次训练的评估。
          </span>
          <span v-if="staleNotice" class="text-xs text-state-warning">
            {{ staleNotice }}
          </span>
        </div>

        <DtNotice
          v-if="model.status === 'failed' && model.error"
          intent="danger"
        >
          {{ model.error }}
        </DtNotice>

        <DtSegmented
          v-model="tab"
          :options="TABS"
          variant="tabs"
          aria-label="模型详情页签"
        />

        <template v-if="tab === TAB_PUBLICATION">
          <PublicationPanel
            :publication="publication"
            @saved="toast.success('绑定已保存')"
            @unbound="toast.success('已解绑')"
            @published="toast.success('已下发一次')"
          />
        </template>

        <MetricsPanel
          v-else
          :model="model"
          :out-of-fold="outOfFold"
          :predictions="predictions"
          :filter="setFilter"
          @update:filter="setFilter = $event"
        />
      </template>
    </div>

    <LiveTestDialog
      :open="isLiveTestOpen"
      :model="model"
      @close="isLiveTestOpen = false"
      @retrain="retrainFromDialog"
    />
  </AppShell>
</template>
