<script setup lang="ts">
/** @fileoverview 工作流训练历史、发布与周期训练入口。 */
import type { ModelingPipeline, ModelingRun } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtIconButton } from '@dt/ui'
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import PermGuard from '@/components/PermGuard.vue'
import PipelineScheduleDialog from '../../components/PipelineScheduleDialog.vue'
import { useRunOps } from '../../scripts/useRunOps'

const props = defineProps<{
  pipeline: ModelingPipeline | null
  run: ModelingRun | null
  isReadonly: boolean
}>()
const emit = defineEmits<{ published: [] }>()
const open = ref(false)
const ops = useRunOps(() => emit('published'))
</script>

<template>
  <template v-if="pipeline">
    <!-- ⚠ custom：不然渲染成 <a> 里套 <button>，Tab 停两次、读屏读成「链接，按钮」 -->
    <RouterLink
      v-slot="{ navigate }"
      :to="`/modeling/runs?pipeline_id=${pipeline.id}`"
      custom
    >
      <DtIconButton
        size="sm"
        variant="ghost"
        icon="list-checks"
        label="训练记录"
        tooltip="查看训练记录"
        @click="navigate"
      />
    </RouterLink>
    <RouterLink
      v-slot="{ navigate }"
      :to="`/modeling/models?pipeline_id=${pipeline.id}`"
      custom
    >
      <DtIconButton
        size="sm"
        variant="ghost"
        icon="layers"
        label="训练模型"
        tooltip="查看训练模型"
        @click="navigate"
      />
    </RouterLink>
    <PermGuard
      v-if="run?.status === 'succeeded'"
      :codes="[PERMISSION_CODES.modelingPublish]"
    >
      <DtButton
        size="sm"
        variant="outline"
        :disabled="run.publication_status === 'pending'"
        :loading="ops.busyId.value !== ''"
        @click="props.run && void ops.publish(props.run.id)"
      >
        {{
          run.publication_status === 'pending' ? '正在发布…' : '发布本次模型'
        }}
      </DtButton>
    </PermGuard>
    <PermGuard :codes="[PERMISSION_CODES.modelingRun]">
      <DtIconButton
        variant="ghost"
        size="sm"
        icon="calendar"
        label="定时训练"
        tooltip="设置定时训练"
        :disabled="isReadonly"
        @click="open = true"
      />
    </PermGuard>
  </template>
  <PipelineScheduleDialog
    :pipeline="open ? pipeline : null"
    @close="open = false"
  />
</template>
