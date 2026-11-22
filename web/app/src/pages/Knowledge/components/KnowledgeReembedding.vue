<script setup lang="ts">
/** @fileoverview 管理员预览整库重嵌、查看进度并取消未完成的任务。 */
import type { KnowledgeReembeddingStatus } from '@dt/contracts'
import { DtButton, DtModal, DtNotice, DtProgress } from '@dt/ui'
import { computed } from 'vue'
import type { KnowledgeBase } from '@/api/knowledge'
import { useReembeddingActions } from '../scripts/useReembeddingActions'
import { isReembeddingActive } from '../scripts/useReembeddingTask'

const props = defineProps<{ base: KnowledgeBase }>()
const emit = defineEmits<{ published: [] }>()
const state = useReembeddingActions(
  () => props.base.id,
  () => emit('published'),
)
const { job, isLoading, error: loadError, refresh } = state.task
const { dialog, preview, isReading, isWriting, error, notice } = state
const active = computed(() => isReembeddingActive(job.value))
const progress = computed(() =>
  job.value?.total_chunks
    ? Math.min(100, (100 * job.value.completed_chunks) / job.value.total_chunks)
    : 0,
)
const statuses: Record<KnowledgeReembeddingStatus, string> = {
  pending: '等待重嵌',
  running: '正在重嵌',
  succeeded: '重嵌已完成',
  failed: '重嵌失败',
  cancelled: '重嵌已取消',
}
</script>

<template>
  <section
    aria-label="整库重嵌"
    class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3 text-sm"
  >
    <div v-if="job" class="min-w-0 flex-1" role="status">
      <p class="m-0 font-medium">{{ statuses[job.status] }}</p>
      <p class="m-0 text-xs text-text-secondary">
        目标模型 {{ job.target_model }} · {{ job.target_dimensions }} 维，已处理
        {{ job.completed_chunks }} / {{ job.total_chunks }} 块
      </p>
      <DtProgress
        v-if="active"
        size="sm"
        class="mt-2 max-w-sm"
        :value="progress"
      />
      <div
        v-if="job.status === 'failed' || job.status === 'cancelled'"
        class="mt-1 text-xs text-text-secondary"
      >
        <p v-if="job.error_message || job.status === 'failed'" class="m-0">
          {{ job.error_message || '后台未返回失败原因。' }}
        </p>
        <p class="m-0">已发布的索引和文档已保留。</p>
      </div>
    </div>
    <DtNotice v-if="loadError" intent="warning" class="basis-full">
      重嵌任务状态未刷新。{{ loadError }}
    </DtNotice>
    <div class="ml-auto flex flex-wrap items-center gap-2">
      <DtButton
        size="sm"
        variant="ghost"
        :loading="isLoading"
        @click="void refresh()"
      >
        刷新任务
      </DtButton>
      <DtButton
        v-if="active"
        size="sm"
        variant="outline"
        intent="warning"
        :disabled="isWriting"
        @click="state.openCancel()"
      >
        取消重嵌
      </DtButton>
      <DtButton
        v-else
        size="sm"
        variant="outline"
        :disabled="isLoading || loadError !== '' || isWriting"
        @click="void state.openPreview()"
      >
        整库重嵌
      </DtButton>
    </div>
  </section>
  <DtModal
    :model-value="dialog !== null"
    :title="dialog === 'cancel' ? '取消本次重嵌？' : '整库重嵌预检'"
    @update:model-value="state.close()"
  >
    <template v-if="dialog === 'preview'">
      <p class="mt-0 text-sm">
        全部数据块处理成功后，「{{ base.name }}」才会切换到目标向量空间。
      </p>
      <p v-if="isReading" role="status">正在读取目标模型与工作量…</p>
      <dl
        v-if="preview"
        class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm"
      >
        <dt>当前模型</dt>
        <dd class="m-0">
          {{ base.embeddingModel ?? '尚未建立索引'
          }}<template v-if="base.dimensions !== null">
            · {{ base.dimensions }} 维</template
          >
        </dd>
        <dt>目标模型</dt>
        <dd class="m-0">
          {{ preview.target_model ?? '不可用'
          }}<template v-if="preview.target_dimensions !== null">
            · {{ preview.target_dimensions }} 维</template
          >
        </dd>
        <template v-if="preview.target_space_id"
          ><dt>目标向量空间</dt>
          <dd class="m-0 break-all font-mono text-xs">
            {{ preview.target_space_id }}
          </dd></template
        >
        <dt>预计工作量</dt>
        <dd class="m-0">
          {{ preview.total_documents }} 份文档，{{ preview.total_chunks }}
          个数据块
        </dd>
        <dt>内容修订号</dt>
        <dd class="m-0">{{ preview.content_revision }}</dd>
      </dl>
      <DtNotice v-if="notice" intent="warning">
        {{ notice }}
      </DtNotice>
      <DtNotice
        v-if="preview?.note"
        :intent="preview.can_start ? 'info' : 'warning'"
      >
        {{ preview.note }}
      </DtNotice>
    </template>
    <p v-else-if="dialog === 'cancel'">
      {{
        active
          ? '取消将停止本次重嵌。文档及已发布的向量索引会保留。'
          : '这个任务已经结束。'
      }}
    </p>
    <DtNotice v-if="error" intent="danger">
      {{ error }}
    </DtNotice>
    <template #footer>
      <DtButton variant="ghost" :disabled="isWriting" @click="state.close()">
        返回
      </DtButton>
      <DtButton
        v-if="dialog === 'preview' && !isReading && !preview?.can_start"
        variant="outline"
        @click="void state.openPreview()"
      >
        重新预检
      </DtButton>
      <DtButton
        v-if="dialog === 'preview'"
        :loading="isWriting"
        :disabled="isReading || !preview?.can_start"
        @click="void state.start()"
      >
        确认重嵌
      </DtButton>
      <DtButton
        v-if="dialog === 'cancel'"
        intent="warning"
        :loading="isWriting"
        :disabled="!active"
        @click="void state.cancel()"
      >
        确认取消
      </DtButton>
    </template>
  </DtModal>
</template>
