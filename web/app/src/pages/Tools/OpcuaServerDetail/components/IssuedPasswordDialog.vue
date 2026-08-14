<script setup lang="ts">
/**
 * @fileoverview 刚签发出来的那一次性明文口令。
 *
 * ⚠ 明文口令只在创建回执里回一次，之后任何接口都取不到。所以它必须当场、
 * 显眼地摆出来，并说清关掉就没了——做成一条会自己消失的 toast，用户就失去了
 * 唯一一次抄走的机会，只能删了凭据重建。
 *
 * ⚠ 复制走 `copyText` 而不是直接 `navigator.clipboard`：本平台按内网 IP 走
 * 纯 HTTP，那里剪贴板 API 不存在，只在现场失效。
 */
import { DtButton, DtIcon, DtModal, DtNotice, useToast } from '@dt/ui'

import { copyText } from '@/utils/clipboard'

const props = defineProps<{
  /** 非 null 时弹出。用户名与明文口令。 */
  issued: { username: string; password: string } | null
}>()
const emit = defineEmits<{ close: [] }>()

const toast = useToast()

/** 口令只此一次，能一键抄走就少一次抄错。 */
async function copy(): Promise<void> {
  const issued = props.issued
  if (issued === null) return
  const ok = await copyText(issued.password)
  if (ok) toast.success('口令已复制')
  else toast.error('复制不了，请手动选中这段口令')
}
</script>

<template>
  <DtModal
    :model-value="issued !== null"
    title="口令只显示这一次"
    @update:model-value="emit('close')"
  >
    <DtNotice intent="warning" icon="alert-triangle">
      现在就抄走。关掉这个窗口之后，任何接口都取不到它——只能删掉凭据重建。
    </DtNotice>
    <div v-if="issued" class="mt-3 flex flex-col gap-2 text-xs">
      <div>
        <span class="text-text-disabled">用户名</span>
        <p class="m-0 font-mono">{{ issued.username }}</p>
      </div>
      <div>
        <span class="text-text-disabled">口令</span>
        <div class="flex items-center gap-2">
          <p class="m-0 break-all font-mono text-base">
            {{ issued.password }}
          </p>
          <DtButton
            size="sm"
            variant="outline"
            aria-label="复制口令"
            @click="copy"
          >
            <DtIcon name="copy" :size="12" />
            复制
          </DtButton>
        </div>
      </div>
    </div>
    <template #footer>
      <DtButton @click="emit('close')">我已抄走</DtButton>
    </template>
  </DtModal>
</template>
