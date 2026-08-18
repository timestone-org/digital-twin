<script setup lang="ts">
/**
 * @fileoverview 签发一枚 API 密钥。
 *
 * ⚠ 归属账号是这个表单最要紧的一格：密钥的权限**完全等于**该账号的权限。
 * 给一个全权账号发密钥，就是把一把不过期的全权钥匙交出去——所以这里把
 * 「该账号有哪些权限」摆在表单里，而不是让人凭账号名去猜。
 *
 * ⚠ 有效期没有「不填即永久」这一档：`null` 要主动选。
 */
import { computed, ref, watch } from 'vue'
import type { DtSelectOption, UserListItem } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtSelect, DtTag } from '@dt/ui'

import { useFormDirty } from '@/composables/useFormDirty'

import * as apiKeys from '@/api/apiKeys'
import { describeError } from '@/composables/useAsyncList'

/** 有效期档位。`''` 是「未选」，`0` 编码「永不过期」。 */
const TTL_OPTIONS: readonly DtSelectOption[] = [
  { value: '90', label: '90 天' },
  { value: '365', label: '1 年' },
  { value: '730', label: '2 年' },
  { value: '0', label: '永不过期' },
]

const NEVER = '0'

const props = defineProps<{
  modelValue: boolean
  users: readonly UserListItem[]
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  issued: [result: { name: string; secret: string }]
}>()

const userId = ref('')
const name = ref('')
const ttl = ref('365')
const busy = ref(false)
const error = ref<string | null>(null)

// ⚠ 填了一半误点遮罩就全没了；脏着时由 DtModal 拦下误关
const { isDirty } = useFormDirty([userId, name, ttl], () => props.modelValue)

const userOptions = computed<readonly DtSelectOption[]>(() =>
  props.users.map((user) => ({
    value: user.id,
    label: `${user.username}（${user.role.name}）`,
  })),
)

const picked = computed<UserListItem | null>(
  () => props.users.find((user) => user.id === userId.value) ?? null,
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    userId.value = ''
    name.value = ''
    ttl.value = '365'
    error.value = null
  },
  // 组件在「已经是打开态」时挂载，只监听变化的 watch 一次都不会跑
  { immediate: true },
)

async function onSubmit(): Promise<void> {
  if (!userId.value || !name.value.trim()) {
    error.value = '请选择归属账号并填写用途'
    return
  }
  busy.value = true
  error.value = null
  try {
    const result = await apiKeys.issueApiKey({
      user_id: userId.value,
      name: name.value.trim(),
      expires_in_days: ttl.value === NEVER ? null : Number(ttl.value),
    })
    emit('issued', {
      name: result.api_key.name,
      secret: result.secret,
    })
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
    :model-value="props.modelValue"
    :dirty="isDirty"
    title="签发 API 密钥"
    description="给第三方系统用的常驻凭据。权限完全继承所选账号。"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtSelect
        v-model="userId"
        label="归属账号"
        :options="userOptions"
        :display="{ placeholder: '选择一个账号', searchable: true }"
      />

      <!-- 摆出权限码，而不是让人凭账号名猜这把钥匙能开哪些门 -->
      <DtNotice v-if="picked" intent="warning" icon="shield">
        <p class="m-0">
          这枚密钥将持有该账号的全部 {{ picked.role.name }} 权限。
        </p>
        <p v-if="picked.direct_permission_count > 0" class="m-0 mt-1">
          该账号另有 {{ picked.direct_permission_count }} 条直权，同样会被继承。
        </p>
      </DtNotice>

      <DtInput
        v-model="name"
        label="用途"
        placeholder="例如：XX 系统写点位"
        hint="只是给人看的标记，日后靠它认出该吊销哪一枚"
      />

      <DtSelect v-model="ttl" label="有效期" :options="TTL_OPTIONS" />
      <DtTag v-if="ttl === NEVER" intent="warning">
        永不过期的密钥只能靠吊销收回，请确认对方有妥善的保管方式
      </DtTag>

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
      <DtButton :loading="busy" @click="onSubmit">签发</DtButton>
    </template>
  </DtModal>
</template>
