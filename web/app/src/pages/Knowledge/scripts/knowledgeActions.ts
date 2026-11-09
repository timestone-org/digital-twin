/**
 * @fileoverview 知识库页的动作：建库删库、传文档、重新解析、删文档、检索。
 * 每个动作回「跑成了没有」，页面按它决定要不要弹成功提示；失败原因在 `state.error`。
 */
import {
  createBase,
  deleteBase,
  deleteDocument,
  readCapability,
  reparseDocument,
  searchBase,
  uploadDocument,
} from '@/api/knowledge'
import { BizError } from '@/api/client'
import {
  cancelSearch,
  guarded,
  messageOf,
  refreshDocuments,
  refreshLibrary,
  refreshBases,
} from './knowledgeState'
import type { KnowledgeState } from './knowledgeState'

/** 建库时固定用的检索策略：关键词与向量两路一起召回。 */
const DEFAULT_STRATEGY = 'hybrid'

/**
 * 取能力与库清单，并选中第一个。
 * @param state 页面状态
 */
export async function reload(state: KnowledgeState): Promise<void> {
  if (state.isDisposed.value) return
  state.error.value = ''
  state.isLoading.value = true
  let isCurrent = false
  await state.reloadRace.run(
    async (signal) => {
      const capability = await readCapability(signal)
      signal.throwIfAborted()
      await refreshBases(state)
      signal.throwIfAborted()
      return capability
    },
    {
      ok: (capability) => {
        isCurrent = true
        state.capability.value = capability
      },
      fail: (cause) => {
        state.error.value = messageOf(cause)
      },
      settled: () => {
        state.isLoading.value = false
      },
    },
  )
  if (!isCurrent || state.isDisposed.value) return
  const first = state.bases.value[0]
  if (state.selectedId.value === '' && first !== undefined) {
    state.selectedId.value = first.id
    await refreshDocuments(state)
  }
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
  cancelSearch(state)
  if (state.selectedId.value !== baseId) state.documents.value = []
  state.selectedId.value = baseId
  await guarded(state, () => refreshDocuments(state))
}

/**
 * 建一个库并切过去。
 * @param state 页面状态
 * @param name 库名
 * @param description 一句说明，可以为空
 */
export async function create(
  state: KnowledgeState,
  name: string,
  description: string,
): Promise<boolean> {
  return guarded(state, async () => {
    const made = await createBase(name, description, DEFAULT_STRATEGY)
    state.countsRace.cancel()
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
): Promise<boolean> {
  return guarded(state, async () => {
    await deleteBase(baseId)
    state.countsRace.cancel()
    state.bases.value = state.bases.value.filter((one) => one.id !== baseId)
    if (state.selectedId.value === baseId) {
      await select(state, '')
    }
  })
}

/** 「这份内容已经在这个库里了」；见 knowledge-server `apps/knowledge/errors.py`。 */
const DUPLICATE_DOCUMENT_CODE = 42308

interface UploadTally {
  uploaded: number
  duplicates: string[]
  failures: string[]
  /** 只传一份时原样抛出那句原因，不套汇总。 */
  single: boolean
}

/** 一批里有重复或失败时的那句汇总；全成功给空串。 */
function tallyText(tally: UploadTally): string {
  if (tally.duplicates.length === 0 && tally.failures.length === 0) return ''
  const parts = [`已传 ${tally.uploaded} 份`]
  if (tally.duplicates.length > 0) {
    parts.push(
      `跳过 ${tally.duplicates.length} 份重复：${tally.duplicates.join('、')}`,
    )
  }
  if (tally.failures.length > 0) {
    parts.push(`失败 ${tally.failures.length} 份：${tally.failures.join('；')}`)
  }
  return parts.join('；')
}

/**
 * 传一份并把结局记进账里。
 * @param state 页面状态
 * @param baseId 传进哪个库
 * @param file 这一份
 * @param tally 这一批的账
 */
async function uploadOne(
  state: KnowledgeState,
  baseId: string,
  file: File,
  tally: UploadTally,
): Promise<void> {
  state.upload.value = { name: file.name, ratio: 0 }
  try {
    await uploadDocument(baseId, file, {
      onProgress: (progress) => {
        state.upload.value = {
          name: file.name,
          ratio: progress.total > 0 ? progress.loaded / progress.total : 0,
        }
      },
    })
    tally.uploaded += 1
  } catch (cause) {
    if (cause instanceof BizError && cause.code === DUPLICATE_DOCUMENT_CODE) {
      tally.duplicates.push(file.name)
    } else {
      tally.failures.push(`${file.name}（${messageOf(cause)}）`)
    }
    if (tally.single) throw cause
  }
}

/**
 * 逐个传文件，回传成了几份。
 * ⚠ 一个一个传而不是并发：并发几份大文件时，进度条只能显示其中一个，
 * 而用户看到的是「卡住了」。
 * ⚠ 一份失败不拦后面的：重复的那份记作跳过，最后一句话说清哪几份没进库。
 * @param state 页面状态
 * @param files 用户选的文件
 */
export async function addFiles(
  state: KnowledgeState,
  files: readonly File[],
): Promise<number> {
  const baseId = state.selectedId.value
  if (baseId === '') return 0
  const tally: UploadTally = {
    uploaded: 0,
    duplicates: [],
    failures: [],
    single: files.length === 1,
  }
  await guarded(state, async () => {
    try {
      for (const file of files) await uploadOne(state, baseId, file, tally)
    } finally {
      if (tally.uploaded > 0) await refreshLibrary(state, [baseId])
    }
    const summary = tallyText(tally)
    if (summary !== '') throw new Error(summary)
  })
  state.upload.value = null
  return tally.uploaded
}

/**
 * 重新解析一份文档。
 * @param state 页面状态
 * @param documentId 哪一份
 */
export async function reparse(
  state: KnowledgeState,
  documentId: string,
): Promise<boolean> {
  return guarded(state, async () => {
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
): Promise<boolean> {
  const baseId = state.selectedId.value
  return guarded(state, async () => {
    await deleteDocument(documentId)
    await refreshLibrary(state, [baseId])
  })
}

/**
 * 跑一次检索。发出去的那句记在 `searched` 上，召回高亮按它算。
 * @param state 页面状态
 */
export async function search(state: KnowledgeState): Promise<void> {
  const baseId = state.selectedId.value
  const wanted = state.query.value.trim()
  if (baseId === '' || wanted === '') return
  state.error.value = ''
  state.isSearching.value = true
  await state.searchesRace.run(
    (signal) => searchBase(baseId, wanted, '', signal),
    {
      ok: (result) => {
        state.result.value = result
        state.searched.value = wanted
      },
      fail: (cause) => {
        state.error.value = messageOf(cause)
      },
      settled: () => {
        state.isSearching.value = false
      },
    },
  )
}
