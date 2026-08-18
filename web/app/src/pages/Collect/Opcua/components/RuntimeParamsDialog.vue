<script setup lang="ts">
/**
 * @fileoverview 采集/归档运行参数弹窗：读有效值 → 逐项渲染（生效档位徽标、
 * 默认值与是否已覆盖）→ 危险方向要求输入确认词 → 保存 → 整组恢复默认。
 *
 * ⚠ 字段清单、标签、说明、上下界全部来自后端目录（`/collect-runtime-params`），
 * 这里不手写一份——两处各写一份时前端放行的值会被服务端拒回，而用户看不出错在哪。
 * ⚠ 非即时档要如实说「保存了但还没生效」：保存成功却什么都没变，用户只会以为
 * 自己改错了地方。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { RuntimeParamItem, RuntimeParamSection } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtModal,
  DtNotice,
  DtPageState,
  useConfirm,
  useToast,
} from '@dt/ui'

import {
  listRuntimeParams,
  resetRuntimeParams,
  saveRuntimeParams,
} from '@/api/runtimeParams'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useAuthStore } from '@/stores/auth'
import { DANGER_TEXT, isDangerousChange } from '../scripts/runtimeParamsMeta'
import DangerConfirmPanel from './DangerConfirmPanel.vue'
import RuntimeParamRow from './RuntimeParamRow.vue'

const props = defineProps<{
  modelValue: boolean
  section: RuntimeParamSection
  title: string
  intro: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const toast = useToast()
const confirm = useConfirm()
const auth = useAuthStore()
const raced = useRacedFetch()
const canWrite = computed(() =>
  auth.can([PERMISSION_CODES.collectManage], 'all'),
)

const items = ref<RuntimeParamItem[]>([])
const draft = ref<Record<string, number | boolean>>({})
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
/** 上一次保存动过的生效档位；非即时档要如实提示。 */
const savedTiers = ref<Set<string>>(new Set())
/** 待确认的危险方向键；非空时展示确认词输入区。 */
const pendingDanger = ref<string[]>([])
let disposed = false

/** 每个待确认键的后果文案。 */
const dangerMessages = computed(() =>
  pendingDanger.value.map((key) => {
    const item = items.value.find((one) => one.key === key)
    return `「${item?.label ?? key}」${DANGER_TEXT[item?.danger ?? 'off']}`
  }),
)

const changed = computed(() =>
  items.value.filter((item) => draft.value[item.key] !== item.value),
)
const dirty = computed(() => changed.value.length > 0)
const hasPendingDanger = computed(() => pendingDanger.value.length > 0)

function absorb(rows: RuntimeParamItem[]): void {
  items.value = rows
  const next: Record<string, number | boolean> = {}
  for (const row of rows) next[row.key] = row.value
  draft.value = next
  pendingDanger.value = []
}

function reason(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  savedTiers.value = new Set()
  await raced.run(() => listRuntimeParams(props.section), {
    ok: (rows) => {
      if (!disposed) absorb(rows)
    },
    fail: (caught) => {
      if (!disposed) error.value = reason(caught, '读取运行参数失败')
    },
    settled: () => {
      if (!disposed) loading.value = false
    },
  })
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load()
  },
  { immediate: true },
)

onUnmounted(() => {
  disposed = true
})

function dangerousKeys(): string[] {
  return changed.value
    .filter((item) => {
      const next = draft.value[item.key]
      return (
        next !== undefined && isDangerousChange(item.danger, item.value, next)
      )
    })
    .map((item) => item.key)
}

function askSave(): void {
  const dangerous = dangerousKeys()
  if (dangerous.length > 0) {
    pendingDanger.value = dangerous
    return
  }
  void commit()
}

function confirmSave(): void {
  pendingDanger.value = []
  void commit()
}

function cancelConfirm(): void {
  pendingDanger.value = []
}

async function commit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const values: Record<string, number | boolean> = {}
    const tiers = new Set<string>()
    for (const item of changed.value) {
      const next = draft.value[item.key]
      if (next === undefined) continue
      values[item.key] = next
      tiers.add(item.tier)
    }
    absorb(await saveRuntimeParams(props.section, values))
    savedTiers.value = tiers
    toast.success('已保存')
  } catch (caught) {
    toast.error(reason(caught, '保存失败'))
  } finally {
    busy.value = false
  }
}

async function reset(): Promise<void> {
  if (busy.value) return
  const agreed = await confirm.ask({
    title: '恢复默认',
    message:
      '会删掉这一组的覆盖值，此后它们重新跟随采集器的环境变量。' +
      '若其中有危险方向的改动（如关掉总开关的覆盖被恢复成开），也会一并生效。',
    confirmText: '恢复默认',
    danger: true,
  })
  if (!agreed) return
  busy.value = true
  try {
    absorb(await resetRuntimeParams(props.section))
    toast.success('已恢复默认，这组参数重新跟随环境变量')
  } catch (caught) {
    toast.error(reason(caught, '恢复默认失败'))
  } finally {
    busy.value = false
  }
}

function onChange(key: string, value: number | boolean): void {
  draft.value = { ...draft.value, [key]: value }
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="title"
    width="44rem"
    :close-on-backdrop="!busy"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <DtPageState
      :loading="loading"
      :error="error"
      :empty="!loading && error === null && items.length === 0"
      empty-icon="settings"
      empty-title="没有可调的参数"
      @retry="load"
    >
      <div class="flex flex-col gap-4">
        <DtNotice icon="circle-question">{{ intro }}</DtNotice>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RuntimeParamRow
            v-for="item in items"
            :key="item.key"
            :item="item"
            :draft="draft[item.key]"
            :disabled="!canWrite || busy"
            @change="onChange(item.key, $event)"
          />
        </div>

        <!-- 非即时档：保存成功不等于已生效，如实说清楚还要做什么 -->
        <DtNotice
          v-if="savedTiers.has('reconnect')"
          intent="warning"
          icon="alert-triangle"
          data-test="reconnect-notice"
        >
          已保存，但这些项要等各数据源「下次重连」才生效——已建立的会话继续用
          旧值。要立刻生效，对那台数据源点一次「断开」再「连接」。
        </DtNotice>
        <DtNotice
          v-if="savedTiers.has('restart')"
          intent="warning"
          icon="alert-triangle"
          data-test="restart-notice"
        >
          已保存，但这一项要等采集进程下次启动才生效。
        </DtNotice>

        <!-- 危险方向：要求原样输入确认词。安全方向不弹——每次都弹，用户会
             训练出无脑点确认的肌肉记忆 -->
        <DangerConfirmPanel
          v-if="hasPendingDanger"
          :messages="dangerMessages"
          @cancel="cancelConfirm"
          @confirm="confirmSave"
        />
      </div>
    </DtPageState>

    <template #footer>
      <DtButton
        v-if="canWrite"
        variant="ghost"
        size="sm"
        :disabled="busy || loading"
        @click="reset"
      >
        恢复默认
      </DtButton>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="busy"
        @click="emit('update:modelValue', false)"
      >
        关闭
      </DtButton>
      <DtButton
        v-if="canWrite"
        size="sm"
        icon="save"
        :loading="busy"
        :disabled="loading || !dirty || hasPendingDanger"
        data-test="runtime-params-save"
        @click="askSave"
      >
        保存
      </DtButton>
    </template>
  </DtModal>
</template>
