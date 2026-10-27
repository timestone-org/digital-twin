<script setup lang="ts">
/** @fileoverview 算子参数的恢复默认操作。 */
import { computed } from 'vue'
import { DtButton } from '@dt/ui'

const props = defineProps<{ fallback: unknown }>()
const emit = defineEmits<{ reset: [] }>()
const title = computed(() => `恢复默认：${JSON.stringify(props.fallback)}`)
</script>

<template>
  <DtButton
    class="dt-ml-form__reset"
    variant="outline"
    intent="neutral"
    :title="title"
    @click="emit('reset')"
  >
    恢复默认
  </DtButton>
</template>
