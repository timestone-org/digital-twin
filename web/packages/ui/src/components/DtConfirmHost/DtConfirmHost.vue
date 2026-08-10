<script setup lang="ts">
/**
 * @fileoverview 二次确认框的渲染宿主。全应用挂一次（App.vue），业务侧 `await ask()`。
 *
 * ⚠ 除「确定」外的所有关闭路径（取消、Esc、遮罩、关闭按钮）都必须 resolve(false)：
 * 漏掉任何一条，调用方的 await 就永远挂着，删除流程静默停在半截。
 */
import { computed } from 'vue'
import DtButton from '../DtButton/DtButton.vue'
import DtModal from '../DtModal/DtModal.vue'
import { useConfirm } from '../../composables/useConfirm'

const { pending, resolve } = useConfirm()

const open = computed(() => pending.value !== null)
</script>

<template>
  <DtModal
    :model-value="open"
    :title="pending?.title ?? '请确认'"
    width="26rem"
    @update:model-value="resolve(false)"
  >
    <p class="dt-confirm__message">{{ pending?.message }}</p>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="resolve(false)">
        {{ pending?.cancelText ?? '取消' }}
      </DtButton>
      <DtButton
        :intent="pending?.danger === true ? 'danger' : 'primary'"
        @click="resolve(true)"
      >
        {{ pending?.confirmText ?? '确定' }}
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-confirm__message {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}
</style>
