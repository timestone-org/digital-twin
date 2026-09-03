<script setup lang="ts">
/**
 * @fileoverview 顶栏上那组「跑一次」的控件：留不留全量结果、运行、取消。
 *
 * ⚠ 「留全量结果」默认不勾：勾着会让每一次运行都往对象存储写几十 MB，而绝大
 * 多数运行只是在调参数（docs/MODELING_PLATFORM_DESIGN.md D12）。
 * ⚠ 运行中只摆「取消」不摆「运行」：一条流水线同时只能有一次在途运行，两个
 * 按钮并排会让人以为再点一次能排队。
 */
import { DtButton, DtCheckbox } from '@dt/ui'

const props = defineProps<{
  isRunning: boolean
  isReadonly: boolean
  isStarting: boolean
}>()

const emit = defineEmits<{ run: []; cancel: [] }>()

const isKeepingFrames = defineModel<boolean>('isKeepingFrames', {
  required: true,
})
</script>

<template>
  <DtCheckbox
    v-model="isKeepingFrames"
    label="留全量结果"
    title="跑完把每一步的完整数据存下来，之后可以在结果面上下载"
  />
  <DtButton
    v-if="props.isRunning"
    size="sm"
    icon="power-off"
    @click="emit('cancel')"
  >
    取消运行
  </DtButton>
  <DtButton
    v-else
    size="sm"
    icon="play"
    :disabled="props.isReadonly"
    :loading="props.isStarting"
    @click="emit('run')"
  >
    运行
  </DtButton>
</template>
