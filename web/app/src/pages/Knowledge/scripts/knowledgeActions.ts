/**
 * @fileoverview 知识库页的动作：建库删库、传文档、重新解析、删文档、检索。
 */
import {
  createBase,
  deleteBase,
  deleteDocument,
  listBases,
  readCapability,
  reparseDocument,
  searchBase,
  uploadDocument,
} from '@/api/knowledge'
import { guarded, refreshDocuments } from './knowledgeState'
import type { KnowledgeState } from './knowledgeState'

/**
 * 取能力与库清单，并选中第一个。
 * @param state 页面状态
 */
export async function reload(state: KnowledgeState): Promise<void> {
  await guarded(state, async () => {
    state.isLoading.value = true
    try {
      state.capability.value = await readCapability()
      state.bases.value = await listBases()
      const first = state.bases.value[0]
      if (state.selectedId.value === '' && first !== undefined) {
        state.selectedId.value = first.id
        await refreshDocuments(state)
      }
    } finally {
      state.isLoading.value = false
    }
  })
}

/**
 * 切到另一个库。
 * ⚠ 顺手清掉上一次的检索结果：留着的话，用户会以为那是新库里的召回。
 * @param state 页面状态
 * @param baseId 切到哪个库
 */
export async function select(
  state: KnowledgeState,
  baseId: string,
): Promise<void> {
  state.selectedId.value = baseId
  state.result.value = null
  await guarded(state, () => refreshDocuments(state))
}

/**
 * 建一个库并切过去。
 * @param state 页面状态
 * @param name 库名
 */
export async function create(
  state: KnowledgeState,
  name: string,
): Promise<void> {
  await guarded(state, async () => {
    const made = await createBase(name, '', 'hybrid')
    state.bases.value = [made, ...state.bases.value]
    await select(state, made.id)
  })
}

/**
 * 删一个库。
 * @param state 页面状态
 * @param baseId 删哪个
 */
export async function drop(
  state: KnowledgeState,
  baseId: string,
): Promise<void> {
  await guarded(state, async () => {
    await deleteBase(baseId)
    state.bases.value = state.bases.value.filter((one) => one.id !== baseId)
    if (state.selectedId.value === baseId) {
      state.selectedId.value = ''
      state.documents.value = []
    }
  })
}

/**
 * 逐个传文件。
 * ⚠ 一个一个传而不是并发：并发几份大文件时，进度条只能显示其中一个，
 * 而用户看到的是「卡住了」。
 * @param state 页面状态
 * @param files 用户选的文件
 */
export async function addFiles(
  state: KnowledgeState,
  files: readonly File[],
): Promise<void> {
  const baseId = state.selectedId.value
  if (baseId === '') return
  await guarded(state, async () => {
    for (const file of files) {
      state.upload.value = { name: file.name, ratio: 0 }
      await uploadDocument(baseId, file, {
        onProgress: (progress) => {
          state.upload.value = {
            name: file.name,
            ratio: progress.total > 0 ? progress.loaded / progress.total : 0,
          }
        },
      })
    }
    await refreshDocuments(state)
  })
  state.upload.value = null
}

/**
 * 重新解析一份文档。
 * @param state 页面状态
 * @param documentId 哪一份
 */
export async function reparse(
  state: KnowledgeState,
  documentId: string,
): Promise<void> {
  await guarded(state, async () => {
    await reparseDocument(documentId)
    await refreshDocuments(state)
  })
}

/**
 * 删一份文档。
 * @param state 页面状态
 * @param documentId 哪一份
 */
export async function removeDocument(
  state: KnowledgeState,
  documentId: string,
): Promise<void> {
  await guarded(state, async () => {
    await deleteDocument(documentId)
    await refreshDocuments(state)
  })
}

/**
 * 跑一次检索。
 * @param state 页面状态
 */
export async function search(state: KnowledgeState): Promise<void> {
  const baseId = state.selectedId.value
  const wanted = state.query.value.trim()
  if (baseId === '' || wanted === '') return
  await guarded(state, async () => {
    state.isSearching.value = true
    try {
      state.result.value = await searchBase(baseId, wanted)
    } finally {
      state.isSearching.value = false
    }
  })
}
