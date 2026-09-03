<script setup lang="ts">
/**
 * @fileoverview 刚铸出来那把钥匙的明文。
 *
 * ⚠ 这是**唯一**一次看得到它的机会：服务端只存摘要，任何接口都取不回明文。
 * 所以它摆在一个要显式关掉的弹窗里，而不是一条会自己消失的 toast。
 */
import type { ModelApiKeyMinted } from '@dt/contracts'
import { DtButton, DtModal, DtNotice, useToast } from '@dt/ui'

const props = defineProps<{ minted: ModelApiKeyMinted | null }>()

const emit = defineEmits<{ close: [] }>()

const toast = useToast()

async function copy(): Promise<void> {
  const plaintext = props.minted?.plaintext
  if (plaintext === undefined) return
  try {
    await navigator.clipboard.writeText(plaintext)
    toast.success('已复制到剪贴板')
  } catch {
    // ⚠ 复制失败不能只吞掉：明文还在屏幕上，得让用户知道要手抄
    toast.error('复制不了，请手动选中上面那串')
  }
}
</script>

<template>
  <DtModal
    :model-value="props.minted !== null"
    title="密钥已生成"
    description="只显示这一次"
    width="34rem"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <DtNotice intent="warning">
        关掉这个窗口之后**再也取不回**这串明文——服务端只存了它的摘要。
        现在就复制给对接方；丢了只能撤销这把、另发一把。
      </DtNotice>
      <p class="dt-ml-minted__value">{{ props.minted?.plaintext }}</p>
      <p class="dt-ml-minted__hint">
        调用时放在请求头里：<code>X-Api-Key: &lt;这串&gt;</code>。 ⚠ 别放进
        URL——URL 会进访问日志、浏览器历史与代理的缓存键。
      </p>
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">我已保存</DtButton>
      <DtButton icon="copy" @click="void copy()">复制</DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-ml-minted {
  &__value {
    margin: 0;
    padding: 0.5rem 0.625rem;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-title);
    font-family: var(--font-mono);
    font-size: var(--ctl-fs-md);
    word-break: break-all;
  }

  &__hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);

    code {
      font-family: var(--font-mono);
    }
  }
}
</style>
