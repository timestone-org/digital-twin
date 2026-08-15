<script setup lang="ts">
/**
 * @fileoverview 从模型节点批量建部件的挑选面：搜索、全选、逐个勾。
 * ⚠ 已被别的部件认领的节点不可选，且要说出是被谁占的——只是禁用而不说原因，
 * 用户会以为这个节点坏了。
 */
import { DtButton, DtCheckbox, DtInput, DtModal, DtTag } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { BulkPartCandidate } from '../bulkParts'

const props = defineProps<{
  open: boolean
  candidates: readonly BulkPartCandidate[]
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  confirm: [names: string[]]
}>()

const keyword = ref('')
const chosen = ref<readonly string[]>([])

// 每次打开都从零开始：留着上一次的勾选，用户以为自己没选却建出一堆部件
watch(
  () => props.open,
  (open) => {
    if (open) {
      keyword.value = ''
      chosen.value = []
    }
  },
)

const visible = computed(() => {
  const word = keyword.value.trim().toLowerCase()
  if (word === '') return props.candidates
  return props.candidates.filter((item) =>
    item.name.toLowerCase().includes(word),
  )
})

/** 当前筛选结果里还能选的那些。 */
const selectable = computed(() =>
  visible.value
    .filter((item) => item.takenBy === null)
    .map((item) => item.name),
)

const allChosen = computed(
  () =>
    selectable.value.length > 0 &&
    selectable.value.every((name) => chosen.value.includes(name)),
)

function isChosen(name: string): boolean {
  return chosen.value.includes(name)
}

function toggle(name: string): void {
  chosen.value = isChosen(name)
    ? chosen.value.filter((item) => item !== name)
    : [...chosen.value, name]
}

function toggleAll(): void {
  chosen.value = allChosen.value ? [] : [...selectable.value]
}

function close(): void {
  emit('update:open', false)
}

function confirm(): void {
  if (chosen.value.length === 0) return
  emit('confirm', [...chosen.value])
  close()
}
</script>

<template>
  <DtModal
    :model-value="open"
    title="从模型节点批量建部件"
    width="34rem"
    @update:model-value="emit('update:open', $event)"
  >
    <div class="dt-bulk">
      <p class="dt-bulk__hint text-2xs">
        勾中的每个节点建一个部件，部件名就取节点名，之后可以再改。
      </p>

      <DtInput
        v-model="keyword"
        size="sm"
        placeholder="搜索节点名"
        data-test="bulk-search"
      />

      <div v-if="candidates.length === 0" class="dt-bulk__empty text-sm">
        模型还没加载出节点。先在「模型与场景」里选一个模型。
      </div>

      <template v-else>
        <DtCheckbox
          :model-value="allChosen"
          :disabled="selectable.length === 0"
          :label="`全选（${selectable.length} 个可选）`"
          data-test="bulk-all"
          @update:model-value="toggleAll"
        />

        <ul class="dt-bulk__list">
          <li v-for="item in visible" :key="item.name" class="dt-bulk__row">
            <DtCheckbox
              :model-value="isChosen(item.name)"
              :disabled="item.takenBy !== null"
              :label="item.name"
              @update:model-value="toggle(item.name)"
            />
            <DtTag v-if="item.takenBy !== null" size="sm">
              已属于 {{ item.takenBy }}
            </DtTag>
          </li>
        </ul>
      </template>
    </div>

    <template #footer>
      <DtButton size="sm" variant="ghost" intent="neutral" @click="close">
        取消
      </DtButton>
      <DtButton
        size="sm"
        :disabled="chosen.length === 0"
        data-test="bulk-confirm"
        @click="confirm"
      >
        建 {{ chosen.length }} 个部件
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-bulk {
  display: flex;
  flex-direction: column;
  gap: 8px;

  &__hint {
    margin: 0;
    color: var(--text-secondary);
  }

  &__empty {
    padding: 24px 0;
    color: var(--text-disabled);
    text-align: center;
  }

  &__list {
    max-height: 18rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  &__row {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 2px 0;
  }
}
</style>
