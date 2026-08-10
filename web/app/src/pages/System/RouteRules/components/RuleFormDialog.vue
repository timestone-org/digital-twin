<script setup lang="ts">
/**
 * @fileoverview 新增 / 修改路由规则。
 *
 * ⚠ 两处必须在界面上讲清楚，否则运维会照着错误的心智模型配：
 * ① 空权限码 = 「任意已登录用户」，不是匿名放行（匿名靠边缘的免认证 location）；
 * ② priority 越大越先判，且**首条命中即终局**——排低了等于没写，排高了会盖住别的规则。
 */
import { computed, ref, watch } from 'vue'
import type { HttpMethod, MatchMode, RouteRule } from '@dt/contracts'
import { HTTP_METHODS } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
} from '@dt/ui'

import * as admin from '@/api/admin'
import { describeError } from '@/composables/useAsyncList'
import PermissionCodePicker from '@/features/permissions/PermissionCodePicker.vue'
import { usePermissionCatalog } from '@/features/permissions/usePermissionCatalog'

const catalog = usePermissionCatalog()

const props = defineProps<{ modelValue: boolean; rule: RouteRule | null }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [message: string]
}>()

const form = ref<{
  path_pattern: string
  http_method: HttpMethod
  match_mode: MatchMode
  priority: string
  is_enabled: boolean
  description: string
}>({
  path_pattern: '/api/v1/',
  http_method: 'GET',
  match_mode: 'all',
  priority: '500',
  is_enabled: true,
  description: '',
})
const selected = ref<Set<string>>(new Set())
const busy = ref(false)
const error = ref<string | null>(null)

const isEdit = computed(() => props.rule !== null)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    error.value = null
    const rule = props.rule
    form.value = {
      path_pattern: rule?.path_pattern ?? '/api/v1/',
      http_method: rule?.http_method ?? 'GET',
      match_mode: rule?.match_mode ?? 'all',
      priority: String(rule?.priority ?? 500),
      is_enabled: rule?.is_enabled ?? true,
      description: rule?.description ?? '',
    }
    selected.value = new Set(rule?.permission_codes ?? [])
    await catalog.ensure()
    error.value = catalog.error.value
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载（深链、或标记与挂载同一 tick）
  // 时，只监听变化的 watch 一次都不会跑，表单会是空的。
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  busy.value = true
  error.value = null
  const payload = {
    path_pattern: form.value.path_pattern,
    http_method: form.value.http_method,
    match_mode: form.value.match_mode,
    priority: Number(form.value.priority),
    is_enabled: form.value.is_enabled,
    permission_codes: [...selected.value],
    description: form.value.description || undefined,
  }
  try {
    if (props.rule) {
      await admin.updateRouteRule(props.rule.id, payload)
      emit('saved', '规则已更新')
    } else {
      await admin.createRouteRule(payload)
      emit('saved', '规则已创建')
    }
    emit('update:modelValue', false)
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    :title="isEdit ? '修改规则' : '新增规则'"
    width="34rem"
    description="改动即改变全系统鉴权矩阵，最长约 10 秒后各副本生效"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-4">
      <DtInput
        v-model="form.path_pattern"
        label="路径模式"
        required
        hint="以 / 开头；* 跨斜杠匹配，如 /api/v1/auth/users*"
      />
      <div class="grid grid-cols-2 gap-4">
        <DtSelect
          v-model="form.http_method"
          label="方法"
          :options="HTTP_METHODS.map((m) => ({ value: m, label: m }))"
        />
        <DtInput
          v-model="form.priority"
          label="优先级"
          type="text"
          hint="0–999，越大越先判，首条命中即终局"
        />
      </div>
      <DtSelect
        v-model="form.match_mode"
        label="判定模式"
        :options="[
          { value: 'all', label: 'all —— 必须持有全部所选码' },
          { value: 'any', label: 'any —— 持有任一即可' },
        ]"
      />
      <DtInput v-model="form.description" label="说明" />
      <DtCheckbox v-model="form.is_enabled" label="启用这条规则" />

      <div>
        <p class="m-0 mb-2 text-xs font-semibold text-text-secondary">
          需要的权限码
          <span class="font-normal text-text-disabled">
            （一个都不选 = 任意已登录用户放行，**不是**匿名放行）
          </span>
        </p>
        <PermissionCodePicker
          v-model="selected"
          :groups="catalog.groups.value"
        />
      </div>

      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton :loading="busy" @click="onSubmit">保存</DtButton>
    </template>
  </DtModal>
</template>
