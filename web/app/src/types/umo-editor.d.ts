/** @fileoverview `@umoteam/editor` 11.1.1 的最小本地类型声明。 */
declare module '@umoteam/editor' {
  import type { Component } from 'vue'
  import type { Editor as TiptapEditor } from '@tiptap/core'

  export interface UmoEditorOptions {
    cdnUrl?: string
    disableExtensions?: string[]
    document?: {
      autoSave?: { enabled?: boolean; interval?: number }
      content?: string | Record<string, unknown>
      placeholder?: string
      readOnly?: boolean
      title?: string
    }
    extensions?: unknown[]
    locale?: string
    onSave?: () => Promise<{
      message?: string
      showMessage?: boolean
      status: 'success' | 'error'
    }>
    page?: Record<string, unknown>
    toolbar?: {
      menus?: (
        'base' | 'insert' | 'table' | 'tools' | 'page' | 'view' | 'export'
      )[]
    }
  }

  export interface UmoEditorInstance {
    getJSON(): Record<string, unknown>
    setContent(content: string | Record<string, unknown>): void
    setReadOnly?(readOnly: boolean): void
  }

  export const UmoEditor: Component
  export default UmoEditor

  export interface UmoCreatedPayload {
    editor?: TiptapEditor
  }
}

declare module '@umoteam/editor/style' {
  const content: string
  export default content
}
