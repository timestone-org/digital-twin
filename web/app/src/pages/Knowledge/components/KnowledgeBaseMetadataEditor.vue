<script setup lang="ts">
/** @fileoverview 管理员编辑已选知识库的名称与描述。 */
import { onScopeDispose, ref, shallowRef } from 'vue'
import type { KnowledgeBaseMetadataPatch } from '@dt/contracts'
import { DtButton, useToast } from '@dt/ui'
import type { KnowledgeBase } from '@/api/knowledge'
import { messageOf } from '../scripts/knowledgeState'
import KnowledgeBaseFormDialog from './KnowledgeBaseFormDialog.vue'

const props = defineProps<{
  base: KnowledgeBase
  save: (id: string, changes: KnowledgeBaseMetadataPatch) => Promise<void>
}>()
const toast = useToast()
const isOpen = ref(false)
const isSaving = ref(false)
const error = ref('')
const original = shallowRef<KnowledgeBase | null>(null)
let isActive = true
onScopeDispose(() => {
  isActive = false
})

function open(): void {
  original.value = props.base
  error.value = ''
  isOpen.value = true
}

async function submit(name: string, description: string): Promise<void> {
  const before = original.value
  if (before === null) return
  const changes: KnowledgeBaseMetadataPatch = {}
  if (name !== before.name) changes.name = name
  if (description !== before.description) changes.description = description
  if (isSaving.value || Object.keys(changes).length === 0) return
  isSaving.value = true
  error.value = ''
  try {
    await props.save(before.id, changes)
    if (isActive) {
      isOpen.value = false
      toast.success('已更新知识库')
    }
  } catch (cause) {
    if (isActive) error.value = messageOf(cause)
  } finally {
    if (isActive) isSaving.value = false
  }
}
</script>

<template>
  <DtButton
    variant="ghost"
    size="sm"
    icon="pencil"
    aria-label="编辑知识库"
    :disabled="isSaving"
    @click="open"
  />
  <KnowledgeBaseFormDialog
    v-if="original"
    v-model="isOpen"
    :initial="original"
    :is-busy="isSaving"
    :error="error"
    @submit="submit"
  />
</template>
