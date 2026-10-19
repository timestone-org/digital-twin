<script setup lang="ts">
/**
 * @fileoverview 数据源表单里的凭据三格：用户名、密码、清空密码。
 *
 * ⚠ 口令是三态而不是两态：留空 = 不动、填了 = 改成新的、勾「清空」= 删掉。
 * 少了「清空」这一档，配错的口令就只能改不能删；而把「留空」当成「删掉」，
 * 每次改端点都会顺手把口令抹掉。
 * ⚠ 「清空密码」只在编辑且**确实存过**口令时才出现：没存过还摆一个开关，
 * 勾了什么也不会发生，用户会以为自己漏了一步。
 */
import { DtField, DtInput, DtSwitch } from '@dt/ui'

defineProps<{
  isEdit: boolean
  /** 这个数据源库里存过口令没有。 */
  hasCredential: boolean
}>()

const username = defineModel<string>('username', { required: true })
const credential = defineModel<string>('credential', { required: true })
const isCleared = defineModel<boolean>('isCleared', { required: true })
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <DtField label="用户名" hint="匿名连接可留空。">
      <DtInput v-model="username" placeholder="匿名连接可留空" />
    </DtField>
    <DtField
      label="密码"
      :hint="isEdit ? '留空保持原密码。' : '只以密文入库，任何接口都不会回它。'"
    >
      <DtInput
        v-model="credential"
        type="password"
        :disabled="isCleared"
        :placeholder="isEdit ? '留空表示不修改' : '匿名连接可留空'"
      />
    </DtField>
  </div>

  <DtField v-if="isEdit && hasCredential" label="清空密码">
    <DtSwitch v-model="isCleared" label="删掉已配置的密码" />
  </DtField>
</template>
