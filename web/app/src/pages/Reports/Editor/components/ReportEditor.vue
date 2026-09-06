<script setup lang="ts">
/** @fileoverview 报告富文本编辑器，正文保留结构化业务节点。 */
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import type { JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { DtButton } from '@dt/ui'
import type { ReportDocument } from '@dt/contracts'
import { businessExtensions } from '../scripts/businessNodes'
import { documentFrom } from '../../scripts/reportDocument'

const props = defineProps<{ modelValue: ReportDocument; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: ReportDocument] }>()
const editor = shallowRef<Editor | null>(null)
let emitted = ''
onMounted(() => {
  editor.value = new Editor({
    extensions: [StarterKit, TableKit, ...businessExtensions],
    content: tiptapDocument(props.modelValue),
    editable: !props.disabled,
    onUpdate: ({ editor: current }) => {
      const doc = documentFrom(current.getJSON())
      emitted = JSON.stringify(doc)
      emit('update:modelValue', doc)
    },
  })
})
watch(
  () => props.modelValue,
  (doc) => {
    if (JSON.stringify(doc) !== emitted)
      editor.value?.commands.setContent(tiptapDocument(doc), {
        emitUpdate: false,
      })
  },
)
watch(
  () => props.disabled,
  (disabled) => editor.value?.setEditable(!disabled),
)
onBeforeUnmount(() => editor.value?.destroy())
function tiptapDocument(doc: ReportDocument): JSONContent {
  return {
    type: doc.type,
    ...(doc.text != null ? { text: doc.text } : {}),
    ...(doc.attrs ? { attrs: doc.attrs } : {}),
    ...(doc.marks ? { marks: doc.marks } : {}),
    ...(doc.content ? { content: doc.content.map(tiptapDocument) } : {}),
  }
}
function insert(node: ReportDocument): void {
  editor.value?.chain().focus().insertContent(tiptapDocument(node)).run()
}
defineExpose({ insert })
</script>
<template>
  <div class="report-editor flex h-full min-h-0 flex-col">
    <div v-if="!props.disabled" class="flex flex-wrap gap-1 border-b p-2">
      <DtButton
        size="sm"
        variant="ghost"
        @click="editor?.chain().focus().undo().run()"
      >
        撤销
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        @click="editor?.chain().focus().redo().run()"
      >
        重做
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        @click="editor?.chain().focus().toggleBold().run()"
      >
        粗体
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        @click="editor?.chain().focus().toggleItalic().run()"
      >
        斜体
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
      >
        标题
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        @click="editor?.chain().focus().toggleBulletList().run()"
      >
        列表
      </DtButton>
      <DtButton
        size="sm"
        variant="ghost"
        @click="
          editor
            ?.chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        "
      >
        表格
      </DtButton>
    </div>
    <div class="min-h-0 flex-1 overflow-auto p-4">
      <EditorContent v-if="editor" :editor="editor" />
    </div>
  </div>
</template>
<style scoped lang="scss">
.report-editor {
  background: var(--surface-panel);
  border: 1px solid var(--border-default);
}
:deep(.tiptap) {
  min-height: 30rem;
  padding: 2rem;
  outline: none;
  background: var(--surface-base);
  color: var(--text-primary);
}
:deep(.tiptap p) {
  margin-block: 0.75rem;
}
:deep(.tiptap h1) {
  font-size: 1.8rem;
  font-weight: 700;
}
:deep(.tiptap ul) {
  list-style: disc;
  padding-left: 1.5rem;
}
:deep(.tiptap table) {
  border-collapse: collapse;
  width: 100%;
}
:deep(.tiptap td),
:deep(.tiptap th) {
  border: 1px solid var(--border-default);
  padding: 0.4rem;
}
:deep(.report-data-node) {
  display: inline-block;
  padding: 0.15rem 0.4rem;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  color: var(--accent-primary);
}
</style>
