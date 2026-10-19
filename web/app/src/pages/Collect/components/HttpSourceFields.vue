<script setup lang="ts">
/** @fileoverview HTTP 请求、认证与响应限制的配置字段。 */
import { computed } from 'vue'
import {
  DtField,
  DtInput,
  DtNumberInput,
  DtSelect,
  DtSwitch,
  DtTextarea,
} from '@dt/ui'
import {
  HTTP_AUTH_OPTIONS,
  HTTP_METHOD_OPTIONS,
} from '../scripts/httpSourceOptions'

defineProps<{ isEdit: boolean; hasCredential: boolean }>()
const options = defineModel<Record<string, string>>({ required: true })
const SAMPLES = {
  headers: '{"Accept":"application/json"}',
  query: '{"device":"line1"}',
  body: '{"filter":{"site":"plant1"}}',
} as const
const username = defineModel<string>('username', { required: true })
const credential = defineModel<string>('credential', { required: true })
const isCleared = defineModel<boolean>('isCleared', { required: true })

function field(key: string, fallback = '') {
  return computed<string>({
    get: () => options.value[key] ?? fallback,
    set: (value) => {
      const next = { ...options.value }
      if (value === '') delete next[key]
      else next[key] = value
      if (key === 'method' && value === 'GET') delete next['body_json']
      if (key === 'auth_type' && value !== 'oauth2_client_credentials') {
        delete next['token_endpoint']
        delete next['scope']
      }
      if (key === 'auth_type' && value !== 'api_key') delete next['auth_header']
      options.value = next
    },
  })
}

const method = field('method', 'GET')
const authType = field('auth_type', 'none')
const headers = field('headers_json', '{}')
const query = field('query_json', '{}')
const body = field('body_json')
const timeout = field('timeout_s', '5')
const responseLimit = field('max_response_bytes', '1048576')
const authHeader = field('auth_header', 'X-API-Key')
const tokenEndpoint = field('token_endpoint')
const scope = field('scope')
const timeoutNumber = computed({
  get: () => Number(timeout.value),
  set: (value: number) => {
    timeout.value = String(value)
  },
})
const responseLimitNumber = computed({
  get: () => Number(responseLimit.value),
  set: (value: number) => {
    responseLimit.value = String(value)
  },
})
const hasUsername = computed(() =>
  ['basic', 'digest', 'oauth2_client_credentials'].includes(authType.value),
)
const hasAuthentication = computed(() => authType.value !== 'none')
const isOAuth = computed(() => authType.value === 'oauth2_client_credentials')
const usernameLabel = computed(() => (isOAuth.value ? 'Client ID' : '用户名'))
const credentialLabel = computed(() => {
  if (isOAuth.value) return 'Client Secret'
  if (authType.value === 'bearer') return 'Bearer Token'
  if (authType.value === 'api_key') return 'API Key'
  return '密码'
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="m-0 text-xs text-text-secondary">
      保存配置后，采集进程需启用 HTTP 采集并允许此接口的地址，才能开始读取。
    </p>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <DtSelect
        v-model="method"
        label="请求方法"
        :options="HTTP_METHOD_OPTIONS"
        aria-label="HTTP 请求方法"
      />
      <DtSelect
        v-model="authType"
        label="认证方式"
        :options="HTTP_AUTH_OPTIONS"
        aria-label="HTTP 认证方式"
      />
    </div>
    <DtField v-if="hasUsername" :label="usernameLabel" required>
      <DtInput
        v-model="username"
        :placeholder="isOAuth ? 'OAuth Client ID' : 'HTTP 认证用户名'"
      />
    </DtField>
    <DtField
      v-if="authType === 'api_key'"
      label="API Key 请求头名称"
      required
      hint="只通过请求头传递，不写入 URL 或查询参数。"
    >
      <DtInput v-model="authHeader" placeholder="X-API-Key" />
    </DtField>
    <template v-if="isOAuth">
      <DtField label="Token URL" required>
        <DtInput
          v-model="tokenEndpoint"
          placeholder="https://api.example.com/oauth/token"
        />
      </DtField>
      <DtField label="Scope" hint="可选，多个 scope 用空格分隔。">
        <DtInput v-model="scope" placeholder="如：read:metrics" />
      </DtField>
    </template>
    <template v-if="hasAuthentication">
      <DtField
        :label="credentialLabel"
        required
        :hint="
          isEdit && hasCredential
            ? '已存凭据；留空保持原值。'
            : '凭据加密保存，接口不会回显。'
        "
      >
        <DtInput
          v-model="credential"
          type="password"
          :disabled="isCleared"
          :placeholder="
            isEdit && hasCredential ? '留空表示不修改认证凭据' : '填写认证凭据'
          "
          autocomplete="new-password"
        />
      </DtField>
      <DtField v-if="isEdit && hasCredential" label="清空认证凭据">
        <DtSwitch v-model="isCleared" label="删掉已保存的认证凭据" />
      </DtField>
    </template>
    <DtTextarea
      v-model="headers"
      label="请求头 JSON"
      hint="名称和取值均为字符串；认证信息填写在认证配置中。"
      :placeholder="SAMPLES.headers"
      :rows="2"
      mono
      aria-label="HTTP 请求头 JSON"
    />
    <DtTextarea
      v-model="query"
      label="查询参数 JSON"
      hint="名称和取值均为字符串，不填写密码或 Token。"
      :placeholder="SAMPLES.query"
      :rows="2"
      mono
      aria-label="HTTP 查询参数 JSON"
    />
    <DtTextarea
      v-if="method === 'POST'"
      v-model="body"
      label="请求体 JSON"
      hint="仅用于查询数据的 POST 接口，采集器会按周期重复调用。"
      :placeholder="SAMPLES.body"
      :rows="3"
      mono
      aria-label="HTTP 请求体 JSON"
    />
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <DtField label="请求超时（秒）" hint="大于 0，最多 10 秒。">
        <DtNumberInput
          v-model="timeoutNumber"
          :range="{ min: 0.1, max: 10, step: 0.1 }"
          aria-label="HTTP 请求超时（秒）"
        />
      </DtField>
      <DtField label="响应上限（字节）" hint="默认 1 MiB，最多 4 MiB。">
        <DtNumberInput
          v-model="responseLimitNumber"
          :range="{ min: 1, max: 4194304, step: 1024 }"
          aria-label="HTTP 响应上限（字节）"
        />
      </DtField>
    </div>
  </div>
</template>
