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
import {
  DtButton,
  DtEmpty,
  DtIcon,
  DtInput,
  DtIconButton,
  DtNotice,
} from '@dt/ui'

const props = defineProps<{ modelValue: Record<string, string> }>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()

interface Row {
  /** 行身份：删中间一行时其余行的输入框不被挪用。 */
  id: number
  key: string
  value: string
}

const rows = ref<Row[]>([])
let lastId = 0
function rowOf(key: string, value: string): Row {
  lastId += 1
  return { id: lastId, key, value }
}

watch(
  () => props.modelValue,
  (next) => {
    const incoming = Object.entries(next).map(([key, value]) => ({
      key,
      value,
    }))
    // 只在真的不一样时重建：每次 emit 都回灌会把正在输入的那一行重置掉
    if (JSON.stringify(incoming) !== JSON.stringify(toEntries(rows.value))) {
      rows.value = incoming.map((one) => rowOf(one.key, one.value))
    }
  },
  { immediate: true, deep: true },
)

function toEntries(current: Row[]): { key: string; value: string }[] {
  return current
    .filter((row) => row.key.trim() !== '')
    .map((row) => ({ key: row.key.trim(), value: row.value }))
}

/** 写了不止一次的参数名。⚠ 合成对象时后写的会静默顶掉先写的。 */
const duplicated = computed(() => {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const { key } of toEntries(rows.value)) {
    if (seen.has(key)) twice.add(key)
    seen.add(key)
  }
  return [...twice]
})

function publish(): void {
  if (duplicated.value.length > 0) return
  const out: Record<string, string> = {}
  for (const row of toEntries(rows.value)) out[row.key] = row.value
  emit('update:modelValue', out)
}

function add(): void {
  rows.value = [...rows.value, rowOf('', '')]
}

function remove(id: number): void {
  rows.value = rows.value.filter((row) => row.id !== id)
  publish()
}

const isEmpty = computed(() => rows.value.length === 0)
</script>

<template>
  <div class="flex flex-col gap-2">
    <DtEmpty v-if="isEmpty" size="inline" title="还没有连接参数。" />
    <DtNotice v-if="duplicated.length > 0" intent="danger" icon="alert-circle">
      参数名「{{ duplicated.join('、') }}」重复，改掉之前这里的改动不会生效。
    </DtNotice>
    <div v-for="row in rows" :key="row.id" class="flex items-center gap-2">
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
        @click="remove(row.id)"
      >
        <DtIcon name="trash" :size="14" />
      </DtButton>
    </div>
    <div>
      <DtIconButton
        variant="outline"
        size="sm"
        intent="primary"
        icon="plus"
        label="添加参数"
        @click="add"
      />
    </div>
  </div>
</template>
