<script setup lang="ts">
/**
 * @fileoverview 模型详情：评估、按组合分组、散点与逐条对比、试算。
 *
 * ⚠ 训练中详情继续显示上一次的评估并挂进度提示——半份/空数据比旧数据危险
 * （AC_MODEL_DESIGN §6）。轮询到终态即停，卸载时清定时器。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { AcModel, ModelPrediction } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCard, DtNotice, DtTag, useConfirm, useToast } from '@dt/ui'

import * as hvac from '@/api/hvac'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import MetricsSummary from './components/MetricsSummary.vue'
import ComparisonCard from './components/ComparisonCard.vue'
import SetMetricsTable from './components/SetMetricsTable.vue'
import RecommendPanel from './components/RecommendPanel.vue'
import {
  MODEL_STATUS_VIEW,
  isModelBusy,
  toSetRows,
} from '@/features/hvac/modelView'

// 训练中的刷新间隔；一页逐条对比的行数
const POLL_INTERVAL_MS = 5000
const PREDICTION_PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()

const modelId = computed(() => String(route.params['modelId'] ?? ''))
const model = ref<AcModel | null>(null)
const error = ref<string | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

/** 逐条对比的组合过滤；空串 = 全部。组合键是 `+` 拼的，后端要逗号分隔。 */
const setFilter = ref('')

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
const setRows = computed(() =>
  model.value?.metrics ? toSetRows(model.value.metrics.by_set) : [],
)
/** 一行要说的那件最要紧的事；失败原因单独有 DtNotice，不进这里。 */
const staleNotice = computed(() => {
  if (model.value?.is_batch_stale === true) return '数据已更新，可重训取最新'
  if (model.value?.is_feature_stale === true) {
    return '特征口径已更新，建议重训'
  }
  return null
})

onMounted(() => {
  void load()
  void predictions.reload()
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
    // 训练刚结束这一刻，逐条对比已整体换掉，跟着刷新
    if (wasBusy && !isModelBusy(found)) void predictions.reload()
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
    back-to="/hvac/models"
    back-label="达标预测"
  >
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.acManage]">
        <div class="flex items-center gap-2">
          <DtButton
            intent="primary"
            size="sm"
            :disabled="model === null || isModelBusy(model)"
            @click="retrain"
          >
            重训
          </DtButton>
          <DtButton intent="danger" variant="ghost" size="sm" @click="remove">
            删除
          </DtButton>
        </div>
      </PermGuard>
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

        <MetricsSummary
          v-if="model.metrics"
          :overall="model.metrics.overall"
          :sample="model.sample_count"
        />
        <DtNotice v-else-if="!isModelBusy(model)" intent="info">
          还没有一次成功的训练。
        </DtNotice>

        <div class="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <!-- ⚠ min-w-0 缺一不可：grid/flex 子项默认不许窄于内容，宽表格会
               顶破页面横滚，而不是在表格自己的滚动容器里滚 -->
          <div class="flex min-h-0 min-w-0 flex-col gap-3">
            <DtCard v-if="setRows.length > 0" class="min-w-0">
              <h2 class="mb-2 text-sm font-semibold text-text-primary">
                按服务组合
              </h2>
              <SetMetricsTable :rows="setRows" />
            </DtCard>

            <ComparisonCard
              v-model:filter="setFilter"
              :predictions="predictions"
              :sets="model.serving_sets"
            />
          </div>

          <DtCard class="min-w-0 self-start">
            <h2 class="mb-2 text-sm font-semibold text-text-primary">
              开机策略推荐
            </h2>
            <RecommendPanel v-if="model.trained_at" :model="model" />
            <p v-else class="text-xs text-text-secondary">训练完成后可用。</p>
          </DtCard>
        </div>
      </template>
    </div>
  </AppShell>
</template>
