<script setup lang="ts">
/**
 * @fileoverview 详情页头部的三颗键：实时测试、重训、删除。
 *
 * ⚠ 实时测试不包 PermGuard：`:recommend` 是纯计算读操作，auth catalog 的窄规则
 * 已经放给 `ac:view`，只读账号也该用得上。
 * ⚠ 它的门槛是 `trained_at` 不是 `status`：`failed` 的模型可能带着上一次成功
 * 训练的工件，那种情况下推荐是能算的。
 */
import type { AcModel } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtTooltip } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { isModelBusy } from '@/features/hvac/modelView'

const props = defineProps<{ model: AcModel | null }>()

const emit = defineEmits<{ liveTest: []; retrain: []; remove: [] }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <DtTooltip
      :content="
        props.model !== null && props.model.trained_at === null
          ? '还没有一次成功的训练，训练完成后可用'
          : ''
      "
    >
      <DtButton
        intent="primary"
        size="sm"
        icon="activity"
        :disabled="props.model === null || props.model.trained_at === null"
        @click="emit('liveTest')"
      >
        实时测试
      </DtButton>
    </DtTooltip>
    <PermGuard :codes="[PERMISSION_CODES.acManage]">
      <DtButton
        variant="outline"
        intent="neutral"
        size="sm"
        :disabled="props.model === null || isModelBusy(props.model)"
        @click="emit('retrain')"
      >
        重训
      </DtButton>
      <DtButton
        intent="danger"
        variant="ghost"
        size="sm"
        @click="emit('remove')"
      >
        删除
      </DtButton>
    </PermGuard>
  </div>
</template>
