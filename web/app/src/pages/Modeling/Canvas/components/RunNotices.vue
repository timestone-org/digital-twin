<script setup lang="ts">
/**
 * @fileoverview 画布上关于「这一次运行」的两条持久提示：读数已陈旧、自动发布没成。
 *
 * ⚠ 训练并发布的发布结果只在运行记录的 `publication_status` 上，节点全绿不代表
 * 发布成了；不在这里说出来，用户会以为新模型已经上线。
 */
import type { ModelingRun } from '@dt/contracts'
import { DtNotice, useToast } from '@dt/ui'
import { watch } from 'vue'

const props = defineProps<{
  run: ModelingRun | null
  /** 运行状态读不到时的原因；null = 读数是新的。 */
  staleReason: string | null
}>()

const toast = useToast()

watch(
  () => [props.run?.id, props.run?.publication_status] as const,
  ([id, status], [previousId, previous]) => {
    if (id === previousId && previous === 'pending' && status === 'published')
      toast.success('本次模型已自动发布')
  },
)
</script>

<template>
  <DtNotice v-if="props.staleReason" intent="warning">
    读不到运行状态了：{{
      props.staleReason
    }}；下面停在最后一次读到的样子，可能已过期。
  </DtNotice>
  <DtNotice v-if="props.run?.publication_status === 'failed'" intent="danger">
    模型训练成功，但自动发布没有成功：{{
      props.run.publication_error || '原因未知'
    }}。可点右上角「发布本次模型」重新发布。
  </DtNotice>
</template>
