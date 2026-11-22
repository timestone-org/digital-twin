<script setup lang="ts">
/** @fileoverview 服务器公开证书的指纹与下载。 */
import type { OpcuaCertificate } from '@dt/contracts'
import { DtButton, DtCard, DtNotice } from '@dt/ui'
import { onScopeDispose, ref, watch } from 'vue'

import { downloadServerCertificate } from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { downloadBytes } from '@/utils/downloadJson'

const props = defineProps<{
  instanceId: string
  certificate: OpcuaCertificate
}>()

const race = useRacedFetch()
const isLoading = ref(false)
const error = ref('')

function save(): void {
  if (isLoading.value || props.certificate.is_download_supported !== true)
    return
  const id = props.instanceId
  isLoading.value = true
  error.value = ''
  void race.run((signal) => downloadServerCertificate(id, signal), {
    ok: (certificate) => downloadBytes(certificate, `opcua-${id}.der`),
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => {
      isLoading.value = false
    },
  })
}

watch(
  [
    () => props.instanceId,
    () => props.certificate.fingerprint,
    () => props.certificate.is_download_supported,
  ],
  () => {
    race.cancel()
    isLoading.value = false
    error.value = ''
  },
)
onScopeDispose(race.cancel)
</script>

<template>
  <DtCard v-if="certificate.fingerprint">
    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 class="m-0 text-sm font-medium">服务器证书</h3>
      <DtButton
        v-if="certificate.is_download_supported"
        data-test="download-server-certificate"
        size="sm"
        variant="outline"
        :loading="isLoading"
        @click="save"
      >
        下载服务器证书
      </DtButton>
    </div>
    <dl class="m-0">
      <dt class="text-xs text-text-secondary">SHA-256 指纹</dt>
      <dd class="m-0 mt-1 break-all font-mono text-xs">
        {{ certificate.fingerprint }}
      </dd>
    </dl>
    <DtNotice v-if="error" class="mt-3" intent="danger">{{ error }}</DtNotice>
  </DtCard>
</template>
