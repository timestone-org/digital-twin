<script setup lang="ts">
/**
 * @fileoverview 大屏推送的四项运行旋钮：读有效值、整组写覆盖值、整组恢复默认。
 *
 * ⚠ 「恢复默认」是**删掉覆盖行**，此后这几项重新跟随环境变量——不是写回一份
 * 硬编码默认值。文案说错会让运维以为改完就再也回不到 .env 的取值了。
 * ⚠ 每项都把 `envName` 显示出来：改完要对着 .env 复核的人需要这个名字。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import {
  DtButton,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtPageState,
  DtTag,
  useConfirm,
  useToast,
} from '@dt/ui'
import type { DtNumberRange, RuntimeParamItem } from '@dt/contracts'

import {
  listRuntimeParams,
  resetRuntimeParams,
  saveRuntimeParams,
} from '@/api/runtimeParams'
import { useRacedFetch } from '@/composables/useRacedFetch'

interface ParamField {
  key: string
  label: string
  hint: string
  unit: string
  range: DtNumberRange
}

/**
 * 四项旋钮的呈现登记。键与后端 `apps/runtime_params/catalog.py` 逐字一致——
 * 对不上的项这里不画，不会静默提交一个后端不认的键。
 */
const DASHBOARD_PARAM_FIELDS: readonly ParamField[] = [
  {
    key: 'publish_window_ms',
    label: '推送合并窗口',
    hint: '一个窗口内的变更并成一帧发出；调大省带宽，代价是画面更迟。',
    unit: 'ms',
    range: { min: 100, step: 100, precision: 0 },
  },
  {
    key: 'publish_max_items',
    label: '单帧最多点位数',
    hint: '一帧里最多带几个点位，超出的顺延到下一帧。',
    unit: '个',
    range: { min: 1, step: 10, precision: 0 },
  },
  {
    key: 'publish_reconcile_interval_s',
    label: '订阅对账间隔',
    hint: '每隔这么久核一次订阅集合，把漏订与多订的补齐清掉。',
    unit: 's',
    range: { min: 0.1, step: 0.5, precision: 1 },
  },
]

/** 出参的 `value` 是 unknown，非数字的项按「没有取值」处理，不塞一个假默认值。 */
function toDraft(rows: readonly RuntimeParamItem[]): Record<string, number> {
  const next: Record<string, number> = {}
  for (const row of rows) {
    if (typeof row.value === 'number') next[row.key] = row.value
  }
  return next
}

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const confirm = useConfirm()
const toast = useToast()

const items = ref<RuntimeParamItem[]>([])
const draft = ref<Record<string, number>>({})
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const raced = useRacedFetch()
let disposed = false

/** 登记表与后端目录取交集：后端没回的项不画，回了但没登记的项不认。 */
const fields = computed(() =>
  DASHBOARD_PARAM_FIELDS.flatMap((field) => {
    const item = items.value.find((row) => row.key === field.key)
    return item === undefined ? [] : [{ ...field, item }]
  }),
)

function absorb(rows: RuntimeParamItem[]): void {
  items.value = rows
  draft.value = toDraft(rows)
}

function reason(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

/** 清空输入框不当成「设成 0」：不回写，数字框会自己滚回上一个合法值。 */
function onParam(key: string, value: number | undefined): void {
  if (value === undefined) return
  draft.value = { ...draft.value, [key]: value }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  await raced.run(() => listRuntimeParams('dashboard'), {
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
  () => props.open,
  (open) => {
    if (open) void load()
  },
  { immediate: true },
)

// 弹窗开着时被卸载，在途那次回来仍会写一个已经不在的状态
onUnmounted(() => {
  disposed = true
})

async function save(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    absorb(await saveRuntimeParams('dashboard', draft.value))
    toast.success('已保存，新的取值立刻生效')
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
      '会删掉这一组的覆盖值，此后它们重新跟随环境变量——运维改 .env 就能再调。当前界面上的取值会被服务端的默认值替换。',
    confirmText: '恢复默认',
    danger: true,
  })
  if (!agreed) return
  busy.value = true
  try {
    absorb(await resetRuntimeParams('dashboard'))
    toast.success('已恢复默认，这组参数重新跟随环境变量')
  } catch (caught) {
    toast.error(reason(caught, '恢复默认失败'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="open"
    title="大屏运行参数"
    description="改的是服务端的推送行为，保存后对所有人生效。"
    width="42rem"
    :close-on-backdrop="!busy"
    @update:model-value="emit('update:open', $event)"
  >
    <DtPageState
      :loading="loading"
      :error="error"
      :empty="fields.length === 0"
      empty-icon="settings"
      empty-title="没有可调的参数"
      @retry="load"
    >
      <div class="flex flex-col gap-4">
        <DtNotice icon="circle-question">
          环境变量是永久默认值，库里只存被改过的项。「恢复默认」删掉覆盖值，
          此后这几项重新跟随 .env，不是写死一份默认值。
        </DtNotice>

        <div v-for="field in fields" :key="field.key" class="dt-param">
          <DtNumberInput
            :model-value="draft[field.key]"
            :label="field.label"
            :hint="field.hint"
            :unit="field.unit"
            :range="field.range"
            :disabled="busy"
            @update:model-value="onParam(field.key, $event)"
          />
          <p class="dt-param__env">
            <DtTag size="sm" mono>{{ field.item.envName }}</DtTag>
            <DtTag v-if="field.item.overridden" size="sm" intent="warning">
              已覆盖
            </DtTag>
            <span v-else class="text-text-disabled">跟随环境变量</span>
          </p>
        </div>
      </div>
    </DtPageState>

    <template #footer>
      <DtButton
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
        @click="emit('update:open', false)"
      >
        关闭
      </DtButton>
      <DtButton
        size="sm"
        icon="save"
        :loading="busy"
        :disabled="loading || fields.length === 0"
        @click="save"
      >
        保存
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-param {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &__env {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 0;
    font-size: 11px;
  }
}
</style>
