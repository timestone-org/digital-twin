<script setup lang="ts">
/**
 * @fileoverview 危险方向的确认区：把每条后果摆出来，要求原样输入确认词。
 * 确认词故意取一个不会下意识打出来的短句，见 `runtimeParamsMeta.ts`。
 */
import { computed, ref } from 'vue'
import { DtButton, DtInput } from '@dt/ui'

import { CONFIRM_WORD } from '../runtimeParamsMeta'

defineProps<{ messages: readonly string[] }>()

const emit = defineEmits<{ cancel: []; confirm: [] }>()

const input = ref('')
const isOk = computed(() => input.value.trim() === CONFIRM_WORD)

function submit(): void {
  if (!isOk.value) return
  input.value = ''
  emit('confirm')
}
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-md border border-state-danger px-3 py-3"
    data-test="danger-confirm"
  >
    <p
      v-for="message in messages"
      :key="message"
      class="m-0 text-xs text-state-danger"
    >
      {{ message }}
    </p>
    <DtInput
      v-model="input"
      :placeholder="`请输入「${CONFIRM_WORD}」以继续`"
      data-test="danger-confirm-input"
    />
    <div class="flex justify-end gap-2">
      <DtButton variant="ghost" size="sm" @click="emit('cancel')">
        取消
      </DtButton>
      <DtButton
        intent="danger"
        size="sm"
        :disabled="!isOk"
        data-test="danger-confirm-ok"
        @click="submit"
      >
        确认保存
      </DtButton>
    </div>
  </div>
</template>
