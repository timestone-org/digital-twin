/**
 * @fileoverview 知识库页的交互编排：把状态与动作绑成页面手上的一件东西。
 *
 * 状态在 `knowledgeState.ts`，动作在 `knowledgeActions.ts`——拆开是因为
 * 动作那一堆逐个都要拿到整份状态，写在一个闭包里会顶破函数行数上限。
 */
import * as actions from './knowledgeActions'
import { createState, refreshDocuments } from './knowledgeState'

export type { UploadState } from './knowledgeState'

export function useKnowledgePage() {
  const state = createState()
  return {
    ...state,
    reload: () => actions.reload(state),
    select: (baseId: string) => actions.select(state, baseId),
    refreshDocuments: () => refreshDocuments(state),
    create: (name: string) => actions.create(state, name),
    drop: (baseId: string) => actions.drop(state, baseId),
    addFiles: (files: readonly File[]) => actions.addFiles(state, files),
    reparse: (documentId: string) => actions.reparse(state, documentId),
    removeDocument: (documentId: string) =>
      actions.removeDocument(state, documentId),
    search: () => actions.search(state),
  }
}
