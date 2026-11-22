/** @fileoverview 预检、确认启动与取消一个知识库的整库重嵌。 */
import type {
  KnowledgeReembeddingJob,
  KnowledgeReembeddingPreview,
  KnowledgeReembeddingStart,
} from '@dt/contracts'
import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { BizError, TransportError } from '@/api/client'
import { newIdempotencyKey } from '@/api/idempotency'
import {
  cancelReembedding,
  previewReembedding,
  startReembedding,
} from '@/api/knowledgeReembedding'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { isReembeddingActive, useReembeddingTask } from './useReembeddingTask'

type Task = ReturnType<typeof useReembeddingTask>
type Attempt = KnowledgeReembeddingStart & { key: string }
const PREVIEW_EXPIRED = 42330
const ACTIVE_JOB_EXISTS = 42331
const START_UNAVAILABLE = 42332
const KEY_CONFLICT = 42334

class ReembeddingActions {
  readonly dialog = ref<'preview' | 'cancel' | null>(null)
  readonly preview = shallowRef<KnowledgeReembeddingPreview | null>(null)
  readonly isReading = ref(false)
  readonly isWriting = ref(false)
  readonly error = ref('')
  readonly notice = ref('')
  private readonly read = useRacedFetch()
  private attempt: Attempt | null = null
  private cancelId: string | null = null

  constructor(
    private readonly baseId: string,
    readonly task: Task,
  ) {
    onBeforeUnmount(this.read.cancel)
  }

  close(): void {
    if (this.isWriting.value) return
    this.read.cancel()
    this.dialog.value = null
    this.isReading.value = false
    this.preview.value = null
    this.cancelId = null
    this.error.value = ''
    this.notice.value = ''
  }

  async openPreview(message = ''): Promise<void> {
    if (this.task.isDisposed() || isReembeddingActive(this.task.job.value))
      return
    this.dialog.value = 'preview'
    this.preview.value = null
    this.isReading.value = true
    this.error.value = ''
    this.notice.value = message
    await this.read.run((signal) => previewReembedding(this.baseId, signal), {
      ok: (preview) => {
        this.preview.value = preview
      },
      fail: (caught) => {
        this.error.value = describeError(caught)
      },
      settled: () => {
        this.isReading.value = false
      },
    })
  }

  async start(): Promise<void> {
    const preview = this.preview.value
    if (
      this.dialog.value !== 'preview' ||
      !preview?.can_start ||
      !preview.target_space_id
    )
      return
    const request = {
      target_space_id: preview.target_space_id,
      expected_revision: preview.content_revision,
    }
    const key = this.keyFor(request)
    await this.write(
      () => startReembedding(this.baseId, request, key),
      (caught) => this.startFailed(caught),
    )
  }

  openCancel(): void {
    const active = this.task.job.value
    if (!active || !isReembeddingActive(active) || this.isWriting.value) return
    this.dialog.value = 'cancel'
    this.cancelId = active.id
    this.error.value = ''
    this.notice.value = ''
  }

  async cancel(): Promise<void> {
    const active = this.task.job.value
    if (
      this.dialog.value !== 'cancel' ||
      !active ||
      active.id !== this.cancelId ||
      !isReembeddingActive(active)
    )
      return
    await this.write(
      () => cancelReembedding(this.baseId, active.id),
      (caught) => {
        this.error.value = describeError(caught)
      },
    )
  }

  private keyFor(request: KnowledgeReembeddingStart): string {
    if (
      !this.attempt ||
      this.attempt.target_space_id !== request.target_space_id ||
      this.attempt.expected_revision !== request.expected_revision
    )
      this.attempt = { ...request, key: newIdempotencyKey() }
    return this.attempt.key
  }

  private async write(
    call: () => Promise<KnowledgeReembeddingJob>,
    fail: (error: unknown) => void | Promise<void>,
  ): Promise<void> {
    if (this.task.isDisposed() || this.isWriting.value) return
    this.isWriting.value = true
    this.error.value = ''
    try {
      const result = await call()
      if (this.task.isDisposed()) return
      this.attempt = null
      this.task.acceptWrite(result)
      this.dialog.value = null
    } catch (caught) {
      if (!this.task.isDisposed()) await fail(caught)
    } finally {
      if (!this.task.isDisposed()) this.isWriting.value = false
    }
  }

  private async startFailed(caught: unknown): Promise<void> {
    const code = caught instanceof BizError ? caught.code : null
    if (code === PREVIEW_EXPIRED || code === START_UNAVAILABLE) {
      this.attempt = null
      await this.openPreview(
        code === PREVIEW_EXPIRED
          ? '库内容或目标模型已变化，请核对新的预检结果。'
          : describeError(caught),
      )
    } else if (code === ACTIVE_JOB_EXISTS) {
      await this.showExistingTask()
    } else {
      if (code === KEY_CONFLICT) {
        this.attempt = null
        this.preview.value = null
      }
      this.error.value = startFailureText(caught)
    }
  }

  private async showExistingTask(): Promise<void> {
    this.attempt = null
    await this.task.refresh()
    if (this.task.isDisposed()) return
    if (this.task.job.value) {
      this.dialog.value = null
      return
    }
    this.preview.value = null
    this.error.value = '该库已有任务，当前未能取得进度，请刷新任务状态。'
  }
}

function startFailureText(caught: unknown): string {
  const message = describeError(caught)
  return caught instanceof TransportError ||
    (caught instanceof BizError && caught.status >= 500)
    ? `启动结果尚未确认。${message}`
    : message
}

export function useReembeddingActions(
  getBaseId: () => string,
  onPublished: () => void,
) {
  // 管理控件按库 ID 挂载；已经提交的请求始终归启动它的库。
  const baseId = getBaseId()
  return new ReembeddingActions(baseId, useReembeddingTask(baseId, onPublished))
}
