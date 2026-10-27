<script setup lang="ts">
/**
 * @fileoverview 分析建模的流水线列表：建、改、删，以及进画布。
 * 一条流水线 = 一张算子图 + 它历次的运行（docs/MODELING_DESIGN.md §3）。
 *
 * ⚠ 搜索是**纯客户端过滤**：流水线是业务级资源，几十条顶天（设计 §9.1）。
 */
import type { DtDataColumn, ModelingPipelineSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtIcon,
  DtInput,
  DtNotice,
  DtTag,
  DtCard,
  DtIconButton,
} from '@dt/ui'
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import * as modeling from '@/api/modeling'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { listEmptyState } from '@/utils/listEmpty'

import PipelineFormDialog from './components/PipelineFormDialog.vue'
import { usePipelineOps } from './scripts/usePipelineOps'
import type { PipelineDraft } from './scripts/usePipelineOps'
import ModelingNav from '../components/ModelingNav.vue'

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
    width: '14rem',
    card: 'actions',
  },
]

const BLANK_EMPTY = {
  title: '还没有流水线',
  hint: '从设计模板创建流水线，在流程图中配置数据与参数。',
}

// 后端 size 的上限。一次取满是「客户端过滤」的前提
const PAGE_SIZE = 200

const view = useViewMode('modeling-pipelines')
const router = useRouter()
const keyword = ref('')

const list = useAsyncList<ModelingPipelineSummary>(
  (query) =>
    modeling.listModelingPipelines({ ...query, includeInstances: false }),
  PAGE_SIZE,
)
const ops = usePipelineOps(() => void list.reload())

async function save(draft: PipelineDraft, template: string): Promise<void> {
  const createdId = await ops.save(draft, template)
  if (createdId !== null) await router.push(`/modeling/pipelines/${createdId}`)
}

const visible = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (needle === '') return list.items.value
  return list.items.value.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.code.toLowerCase().includes(needle),
  )
})

// ⚠ 取回的比库里的少时必须明说：本地筛选只筛得到手上这一批
const missing = computed(() =>
  Math.max(list.total.value - list.items.value.length, 0),
)

const emptyState = computed(() =>
  listEmptyState({
    isFiltered: keyword.value.trim() !== '',
    subject: '流水线',
    keyword: keyword.value,
    blank: BLANK_EMPTY,
  }),
)

onMounted(() => void list.reload())
</script>

<template>
  <AppShell
    title="建模工作台"
    subtitle="从设计模板创建流水线，在流程图中完成配置与运行"
  >
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.modelingManage]" explain>
        <DtButton icon="plus" @click="ops.openCreate">新建流水线</DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <ModelingNav />
      <DtCard class="dt-ml-list__guide" padding="sm">
        <ol class="dt-ml-list__steps" aria-label="建模步骤">
          <li>
            <DtTag intent="primary">01</DtTag>
            <strong>选择设计模板</strong>
            <p>按分析目标选择已有流程</p>
          </li>
          <li>
            <DtTag intent="primary">02</DtTag>
            <strong>配置流程图</strong>
            <p>选择数据，调整算子参数</p>
          </li>
          <li>
            <DtTag intent="primary">03</DtTag>
            <strong>运行并查看结果</strong>
            <p>校验运行，按节点查看结果</p>
          </li>
        </ol>
      </DtCard>
      <DtNotice v-if="missing > 0" intent="warning" icon="alert-triangle">
        还有 {{ missing }} 条流水线没取回来，搜索只筛得到已经列出的这
        {{ list.items.value.length }} 条。
      </DtNotice>

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="visible"
        :loading="list.loading.value"
        :error="list.error.value"
        :empty="emptyState"
        :layout="{
          fixedLayout: true,
          minWidth: '64rem',
          cardColumns: 3,
          cardMinWidth: '20rem',
        }"
        @retry="void list.reload()"
      >
        <template #toolbar>
          <div class="flex flex-wrap items-center gap-3">
            <h2 class="text-section font-semibold">我的流水线</h2>
            <DtTag v-if="!list.loading.value && !list.error.value">
              {{ list.total.value }} 条
            </DtTag>
          </div>
          <DtInput
            v-model="keyword"
            class="w-72 max-w-full"
            aria-label="搜索流水线"
            type="search"
            size="sm"
            placeholder="按名称或编码搜索"
          >
            <template #leading><DtIcon name="search" :size="14" /></template>
          </DtInput>
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
          <div class="dt-ml-list__actions">
            <DtButton
              variant="soft"
              size="sm"
              icon="workflow"
              @click="void router.push(`/modeling/pipelines/${row.id}`)"
            >
              打开流程图
            </DtButton>
            <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
              <DtIconButton
                variant="ghost"
                size="sm"
                icon="pencil"
                label="编辑信息"
                @click="ops.openEdit(row)"
              />
              <DtIconButton
                variant="ghost"
                size="sm"
                icon="trash"
                label="删除流水线"
                @click="void ops.remove(row)"
              />
            </PermGuard>
          </div>
        </template>
      </DtDataView>
    </div>

    <PipelineFormDialog
      :draft="ops.draft.value"
      :is-saving="ops.isSaving.value"
      @submit="(draft, template) => void save(draft, template)"
      @close="ops.close"
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

  &__code-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__sources {
    display: block;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    gap: 0.25rem;
    justify-content: flex-end;
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-secondary);
  }
}
</style>
