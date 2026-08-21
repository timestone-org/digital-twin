<script setup lang="ts">
/**
 * @fileoverview 连接参数的键值编辑器：驱动特有的旁路配置。
 *
 * ⚠ 值一律按字符串下发：库里是 jsonb，塞进数字或对象也存得下，但驱动只认
 * 字符串——静默传过去会在协议库里炸成一个与配置毫无关系的异常。
 * ⚠ 键为空的行直接丢掉，不提交一个空键：后端会以 422 拒整个请求，而用户
 * 只会看到「参数不合法」而不知道是哪一行。
 */
import { computed, ref, watch } from 'vue'
import { DtButton, DtEmpty, DtIcon, DtInput } from '@dt/ui'

const props = defineProps<{ modelValue: Record<string, string> }>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()

interface Row {
  key: string
  value: string
}

const rows = ref<Row[]>([])

watch(
  () => props.modelValue,
  (next) => {
    const incoming = Object.entries(next).map(([key, value]) => ({
      key,
      value,
    }))
    // 只在真的不一样时重建：每次 emit 都回灌会把正在输入的那一行重置掉
    if (JSON.stringify(incoming) !== JSON.stringify(toEntries(rows.value))) {
      rows.value = incoming
    }
  },
  { immediate: true, deep: true },
)

function toEntries(current: Row[]): Row[] {
  return current
    .filter((row) => row.key.trim() !== '')
    .map((row) => ({ key: row.key.trim(), value: row.value }))
}

function publish(): void {
  const out: Record<string, string> = {}
  for (const row of toEntries(rows.value)) out[row.key] = row.value
  emit('update:modelValue', out)
}

function add(): void {
  rows.value = [...rows.value, { key: '', value: '' }]
}

function remove(index: number): void {
  rows.value = rows.value.filter((_, position) => position !== index)
  publish()
}

const isEmpty = computed(() => rows.value.length === 0)
</script>

<template>
  <div class="flex flex-col gap-2">
    <DtEmpty v-if="isEmpty" size="inline" title="还没有连接参数。" />
    <div
      v-for="(row, index) in rows"
      :key="`option-${index}`"
      class="flex items-center gap-2"
    >
      <DtInput
        v-model="row.key"
        class="w-40 font-mono"
        size="sm"
        placeholder="参数名"
        @blur="publish"
      />
      <DtInput
        v-model="row.value"
        class="flex-1 font-mono"
        size="sm"
        placeholder="取值"
        @blur="publish"
      />
      <DtButton
        variant="ghost"
        size="sm"
        aria-label="删除这一行"
        @click="remove(index)"
      >
        <DtIcon name="trash" :size="14" />
      </DtButton>
    </div>
    <div>
      <DtButton variant="outline" size="sm" icon="plus" @click="add">
        添加参数
      </DtButton>
    </div>
  </div>
</template>
