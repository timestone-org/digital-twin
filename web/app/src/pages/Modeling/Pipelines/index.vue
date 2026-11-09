<script setup lang="ts">
/**
 * @fileoverview 分析建模的工作流列表：建、改、删，以及进画布。
 * 一条工作流 = 一张算子图 + 它历次的运行（docs/MODELING_DESIGN.md §3）。
 */
import type { DtDataColumn, ModelingPipelineSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtIcon,
  DtIconButton,
  DtInput,
  DtTag,
  DtCard,
} from '@dt/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import * as modeling from '@/api/modeling'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { listEmptyState } from '@/utils/listEmpty'
import { reloadModelingPage } from '../scripts/reloadModelingPage'

import PipelineFormDialog from './components/PipelineFormDialog.vue'
import PipelineImportDialog from './components/PipelineImportDialog.vue'
import PipelineActions from './components/PipelineActions.vue'
import PipelineCard from './components/PipelineCard.vue'
import PipelineBatchScheduleDialog from './components/PipelineBatchScheduleDialog.vue'
import ModelingBatchBar from '../components/ModelingBatchBar.vue'
import PipelineScheduleDialog from '../components/PipelineScheduleDialog.vue'
import PublishTemplateDialog from '../components/PublishTemplateDialog.vue'
import { usePipelineTransfer } from './scripts/usePipelineTransfer'
import { usePipelineOps } from './scripts/usePipelineOps'
import type { PipelineDraft } from './scripts/usePipelineOps'
import { usePipelineBatch } from './scripts/usePipelineBatch'
import type { PipelineBatchScheduleDraft } from './scripts/pipelineBatchSchedule'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', width: '14rem', card: 'title' },
  { key: 'code', label: '编码', width: '10rem', card: 'meta' },
  { key: 'node_count', label: '算子数', width: '5rem', align: 'right' },
  { key: 'sources', label: '取自台账', width: '8rem' },
  { key: 'updated_at', label: '最近改动', width: '11rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '13rem',
    card: 'actions',
  },
]

const BLANK_EMPTY = {
  title: '还没有工作流',
  hint: '从模板创建或导入工作流，配置后即可训练并发布。',
}

const view = useViewMode('modeling-pipelines')
const router = useRouter()
const keyword = ref('')
const appliedKeyword = ref('')
const scheduling = ref<ModelingPipelineSummary | null>(null)
const savingTemplate = ref<ModelingPipelineSummary | null>(null)
const isBatchScheduling = ref(false)
const batchScheduleCount = ref(0)

const list = useAsyncList<ModelingPipelineSummary>((query, signal) =>
  modeling.listModelingPipelines(
    { ...query, q: appliedKeyword.value, includeInstances: false },
    signal,
  ),
)
const ops = usePipelineOps(() => void reloadModelingPage(list))
const transfer = usePipelineTransfer((id) => {
  void list.reload()
  void router.push(`/modeling/pipelines/${id}`)
})

async function save(draft: PipelineDraft, template: string): Promise<void> {
  if (writeLocked.value || !bulk.canManage.value) return
  const createdId = await ops.save(draft, template)
  if (createdId !== null) await router.push(`/modeling/pipelines/${createdId}`)
}

async function search(): Promise<void> {
  appliedKeyword.value = keyword.value.trim()
  await list.reloadFromFirstPage()
}

const emptyState = computed(() =>
  listEmptyState({
    isFiltered: appliedKeyword.value !== '',
    subject: '工作流',
    keyword: appliedKeyword.value,
    blank: BLANK_EMPTY,
  }),
)

const bulk = usePipelineBatch(
  () => list.items.value,
  () =>
    JSON.stringify([
      appliedKeyword.value,
      list.pager.value.page,
      list.pager.value.size,
    ]),
  () => reloadModelingPage(list),
  () =>
    list.loading.value ||
    ops.isSaving.value ||
    transfer.isOpen.value ||
    ops.draft.value !== null ||
    scheduling.value !== null ||
    savingTemplate.value !== null,
)
const writeLocked = computed(
  () =>
    ops.isSaving.value || bulk.batch.isBusy.value || bulk.batch.isBlocked.value,
)
function openCreation(): void {
  if (!writeLocked.value && bulk.canManage.value) ops.openCreate()
}
function openImport(): void {
  if (!writeLocked.value && bulk.canManage.value) transfer.isOpen.value = true
}
async function rowAction(
  action: 'schedule' | 'template' | 'copy' | 'edit' | 'remove',
  row: ModelingPipelineSummary,
): Promise<void> {
  if (writeLocked.value) return
  if (action === 'schedule') {
    if (bulk.canTrain.value) scheduling.value = row
    return
  }
  if (!bulk.canManage.value) return
  if (action === 'template') savingTemplate.value = row
  if (action === 'copy') ops.openCopy(row)
  if (action === 'edit') ops.openEdit(row)
  if (action === 'remove') await ops.remove(row)
}
function openBatchSchedule(): void {
  if (!bulk.canAct.value || !bulk.canTrain.value) return
  batchScheduleCount.value = bulk.batch.selectedCount.value
  isBatchScheduling.value = true
}
async function saveBatchSchedule(
  draft: PipelineBatchScheduleDraft,
): Promise<void> {
  if (!bulk.canAct.value || !bulk.canTrain.value) return
  const report = await bulk.enableSchedules(draft)
  if (report !== null) isBatchScheduling.value = false
}
watch(
  () => [
    bulk.batch.selectedCount.value,
    bulk.batch.isBusy.value,
    bulk.canTrain.value,
  ],
  () => {
    if (!isBatchScheduling.value || bulk.batch.isBusy.value) return
    if (bulk.batch.selectedCount.value === 0 || !bulk.canTrain.value)
      isBatchScheduling.value = false
    else batchScheduleCount.value = bulk.batch.selectedCount.value
  },
)
onMounted(() => void list.reload())
</script>

<template>
  <AppShell
    title="工作流"
    subtitle="创建工作流 → 训练生成模型 → 发布调用；每个工作流保留一个发布入口"
  >
    <template #actions>
      <RouterLink v-slot="{ navigate }" to="/modeling/instances" custom>
        <DtButton variant="ghost" size="sm" @click="navigate">
          历史实例
        </DtButton>
      </RouterLink>
      <PermGuard :codes="[PERMISSION_CODES.modelingManage]" explain>
        <DtIconButton
          variant="outline"
          intent="neutral"
          icon="upload"
          label="导入 JSON"
          :disabled="writeLocked"
          @click="openImport"
        />
        <DtButton icon="plus" :disabled="writeLocked" @click="openCreation">
          新建工作流
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtCard class="dt-ml-list__guide" padding="sm">
        <ol class="dt-ml-list__steps" aria-label="建模步骤">
          <li>
            <DtTag intent="primary">01</DtTag>
            <strong>创建工作流</strong>
            <p>选择模板、复制或导入 JSON</p>
          </li>
          <li>
            <DtTag intent="primary">02</DtTag>
            <strong>配置与训练</strong>
            <p>配置数据和参数，保留每次训练结果</p>
          </li>
          <li>
            <DtTag intent="primary">03</DtTag>
            <strong>发布模型</strong>
            <p>选择训练模型发布，保留固定调用地址</p>
          </li>
        </ol>
      </DtCard>
      <ModelingBatchBar
        :selected-count="bulk.batch.selectedCount.value"
        :state="bulk.batch.state.value"
        scope-label="当前页工作流"
        @clear="bulk.batch.clear()"
        @stop="bulk.batch.stop()"
      >
        <PermGuard :codes="[PERMISSION_CODES.modelingRun]">
          <DtButton
            size="sm"
            :disabled="!bulk.canAct.value"
            @click="openBatchSchedule"
          >
            批量开启定时训练
          </DtButton>
          <DtButton
            size="sm"
            variant="outline"
            :disabled="!bulk.canAct.value"
            @click="void bulk.disableSchedules()"
          >
            批量关闭定时训练
          </DtButton>
          <DtButton
            size="sm"
            variant="outline"
            :disabled="!bulk.canAct.value"
            @click="void bulk.train()"
          >
            批量训练
          </DtButton>
        </PermGuard>
        <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
          <DtButton
            size="sm"
            intent="danger"
            variant="outline"
            :disabled="!bulk.canAct.value"
            @click="void bulk.remove()"
          >
            批量删除工作流
          </DtButton>
        </PermGuard>
      </ModelingBatchBar>

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :empty="emptyState"
        :selection="bulk.selection.value"
        :pagination="list.pager.value"
        :layout="{
          fixedLayout: true,
          minWidth: '60rem',
          cardColumns: 3,
          cardMinWidth: '22rem',
        }"
        @retry="void list.reload()"
        @update:page="void list.goToPage($event)"
        @update:size="void list.setSize($event)"
        @update:selected-ids="bulk.batch.selectedIds.value = $event"
      >
        <template #toolbar>
          <div class="flex flex-wrap items-center gap-3">
            <h2 class="text-section font-semibold">我的工作流</h2>
            <DtTag v-if="!list.loading.value && !list.error.value">
              {{ list.total.value }} 条
            </DtTag>
          </div>
          <form class="flex items-center gap-2" @submit.prevent="void search()">
            <DtInput
              v-model="keyword"
              class="w-72 max-w-full"
              aria-label="搜索工作流"
              type="search"
              size="sm"
              placeholder="按名称或编码搜索"
              :maxlength="128"
            >
              <template #leading><DtIcon name="search" :size="14" /></template>
            </DtInput>
            <DtButton type="submit" size="sm" variant="ghost">搜索</DtButton>
          </form>
        </template>
        <template #card="{ row }">
          <PipelineCard :row="row">
            <template #actions>
              <PipelineActions
                :row="row"
                :is-saving="writeLocked"
                :exporting-id="transfer.exportingId.value"
                @open="
                  (item) => void router.push(`/modeling/pipelines/${item.id}`)
                "
                @export="(item) => void transfer.exportSaved(item)"
                @schedule="void rowAction('schedule', $event)"
                @save-template="void rowAction('template', $event)"
                @copy="void rowAction('copy', $event)"
                @edit="void rowAction('edit', $event)"
                @remove="void rowAction('remove', $event)"
              />
            </template>
          </PipelineCard>
        </template>
        <template #cell-name="{ row }">
          <RouterLink
            class="dt-ml-list__link"
            :to="`/modeling/pipelines/${row.id}`"
          >
            {{ row.name }}
          </RouterLink>
        </template>
        <template #cell-code="{ row }">
          <DtTag class="dt-ml-list__code" intent="neutral" size="sm" mono>
            <span class="dt-ml-list__code-text" :title="row.code">
              {{ row.code }}
            </span>
          </DtTag>
        </template>
        <template #cell-node_count="{ row }">{{ row.node_count }}</template>
        <template #cell-sources="{ row }">
          <span v-if="row.source_table_codes.length === 0">—</span>
          <span v-else class="dt-ml-list__sources">
            {{ row.source_table_codes.join('、') }}
          </span>
        </template>
        <template #cell-updated_at="{ row }">
          {{ formatDateTime(row.updated_at) }}
        </template>
        <template #cell-actions="{ row }">
          <PipelineActions
            :row="row"
            :is-saving="writeLocked"
            :exporting-id="transfer.exportingId.value"
            @open="(item) => void router.push(`/modeling/pipelines/${item.id}`)"
            @export="(item) => void transfer.exportSaved(item)"
            @schedule="void rowAction('schedule', $event)"
            @save-template="void rowAction('template', $event)"
            @copy="void rowAction('copy', $event)"
            @edit="void rowAction('edit', $event)"
            @remove="void rowAction('remove', $event)"
          />
        </template>
      </DtDataView>
    </div>

    <PipelineFormDialog
      :draft="ops.draft.value"
      :is-saving="ops.isSaving.value"
      @submit="(draft, template) => void save(draft, template)"
      @close="ops.close"
    />
    <PipelineImportDialog :transfer="transfer" />
    <PipelineScheduleDialog :pipeline="scheduling" @close="scheduling = null" />
    <PipelineBatchScheduleDialog
      v-if="isBatchScheduling"
      :count="batchScheduleCount"
      :is-busy="bulk.batch.isBusy.value"
      @submit="(draft) => void saveBatchSchedule(draft)"
      @stop="bulk.batch.stop()"
      @close="isBatchScheduling = false"
    />
    <PublishTemplateDialog
      :pipeline="savingTemplate"
      @close="savingTemplate = null"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.dt-ml-list {
  &__guide {
    flex-shrink: 0;
  }
  &__steps {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  &__steps li {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 0.75rem;
    row-gap: 0.25rem;
    min-width: 0;
  }
  &__steps strong {
    font-size: var(--font-size-body);
    font-weight: 600;
  }
  &__steps p {
    grid-column: 2;
    color: var(--text-secondary);
    font-size: var(--font-size-caption);
    margin: 0.25rem 0 0;
  }
  @media (width < 48rem) {
    &__steps {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }
    &__steps p {
      grid-column: 2;
      display: none;
    }
  }
  &__link {
    color: var(--accent-primary);
  }

  &__code {
    max-width: 100%;
  }

  // ⚠ 行高要撑开：DtTag 给的是 line-height:1，配上 overflow:hidden 会把下划线这类下伸笔画裁掉
  &__code-text {
    min-width: 0;
    overflow: hidden;
    line-height: 1.4;
    text-overflow: ellipsis;
  }

  &__sources {
    display: block;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
