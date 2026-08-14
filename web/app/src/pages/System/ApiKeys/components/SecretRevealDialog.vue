<script setup lang="ts">
/**
 * @fileoverview 刚签发出来的那一次性明文密钥。
 *
 * ⚠ 明文只在签发回执里回一次，库里只有散列，之后任何接口都取不到。所以它必须
 * 当场、显眼地摆出来，并说清关掉就没了——做成一条会自己消失的 toast，用户就
 * 失去了唯一一次抄走的机会，只能吊销重发。
 *
 * ⚠ 顺带给一段调用示例：拿到密钥的人下一步要做的事就是把它接进自己的程序，
 * 而「Bearer 后面直接放它、不需要任何刷新循环」正是最容易被问的一句。
 */
import { computed } from 'vue'
import { DtButton, DtIcon, DtModal, DtNotice, useToast } from '@dt/ui'

import { copyText } from '@/utils/clipboard'

const props = defineProps<{
  /** 非 null 时弹出。用途名与明文。 */
  issued: { name: string; secret: string } | null
}>()
const emit = defineEmits<{ close: [] }>()

const toast = useToast()

const usage = computed(() =>
  [
    `curl -X POST "$BASE/api/v1/opcua/instances/{实例}/nodes/{节点}:write" \\`,
    `  -H "Authorization: Bearer ${props.issued?.secret ?? ''}" \\`,
    `  -H "Idempotency-Key: $(uuidgen)" \\`,
    `  -d '{"value": 42.5}'`,
  ].join('\n'),
)

async function copy(text: string, what: string): Promise<void> {
  const ok = await copyText(text)
  if (ok) toast.success(`${what}已复制`)
  else toast.error(`复制不了，请手动选中这段${what}`)
}
</script>

<template>
  <DtModal
    :model-value="issued !== null"
    title="密钥只显示这一次"
    @update:model-value="emit('close')"
  >
    <DtNotice intent="warning" icon="alert-triangle">
      现在就抄走。关掉这个窗口之后，任何接口都取不到它——只能吊销后重发。
    </DtNotice>

    <div v-if="issued" class="mt-3 flex flex-col gap-3 text-xs">
      <div>
        <span class="text-text-disabled">用途</span>
        <p class="m-0">{{ issued.name }}</p>
      </div>

      <div>
        <span class="text-text-disabled">密钥</span>
        <div class="flex items-start gap-2">
          <p class="m-0 break-all font-mono text-base">{{ issued.secret }}</p>
          <DtButton
            size="sm"
            variant="outline"
            aria-label="复制密钥"
            @click="copy(issued.secret, '密钥')"
          >
            <DtIcon name="copy" :size="12" />
            复制
          </DtButton>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between">
          <span class="text-text-disabled">怎么用</span>
          <DtButton
            size="sm"
            variant="ghost"
            intent="neutral"
            aria-label="复制调用示例"
            @click="copy(usage, '示例')"
          >
            <DtIcon name="copy" :size="12" />
            复制示例
          </DtButton>
        </div>
        <!-- ⚠ 交给第三方的是「直接当 Bearer 用」，不需要登录、不需要刷新循环 -->
        <pre
          class="m-0 overflow-x-auto rounded bg-surface-sunken p-2 font-mono text-2xs"
          >{{ usage }}</pre>
        <p class="m-0 mt-2 text-text-disabled">
          放在对方的服务端配置里，别放进浏览器——它不过期，落进前端就是把一把
          长期钥匙交给了 XSS。
        </p>
      </div>
    </div>

    <template #footer>
      <DtButton @click="emit('close')">我已抄走</DtButton>
    </template>
  </DtModal>
</template>
