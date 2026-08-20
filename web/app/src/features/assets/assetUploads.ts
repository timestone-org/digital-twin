/**
 * @fileoverview 上传队列：多个文件一个接一个传，每个都带进度、可整体中止。
 *
 * ⚠ 串行而不是并发：素材里最大的一档是 256MB 的模型，几个一起传会把上行带宽
 * 分光，表现是每一条进度都在爬而没有一条传得完。串行还让「现在传的是哪个」
 * 这件事在界面上有唯一答案。
 * ⚠ 队列 id 用自增计数而不是 `crypto.randomUUID()`：后者只在安全上下文里有，
 * 本站以明文 HTTP 部署时它是 `undefined`，而现场看到的是打开页面就整片白。
 */
import type { AssetKind } from '@dt/contracts'
import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import type { Asset } from '@/api/assets'
import { uploadAsset } from '@/api/assets'
import { messageOf } from './assetLoading'

/** 一个文件在队列里的状态。 */
export type UploadStatus = 'waiting' | 'uploading' | 'done' | 'failed'

/** 队列里的一项。 */
export interface UploadJob {
  /** 队列内的本地 id，只用来做列表的 key。 */
  id: string
  name: string
  kind: AssetKind
  sizeBytes: number
  /** 已传字节。总数用 `sizeBytes`——浏览器报的总数含表单字段，会略大于文件本身。 */
  loaded: number
  status: UploadStatus
  /** 失败原因；其余状态是空串。 */
  error: string
}

export interface AssetUploads {
  jobs: Ref<readonly UploadJob[]>
  /** 队列里还有没传完的。 */
  isBusy: ComputedRef<boolean>
  /** 已传完（成功或失败）的项数，给界面决定要不要显示「清空」。 */
  finishedCount: ComputedRef<number>
  /** 排队上传一批文件，回其中传成功的那些（新的在前）。 */
  enqueue: (kind: AssetKind, files: readonly File[]) => Promise<Asset[]>
  /** 中止在途上传并清空队列；关闭弹窗与卸载时都要调。 */
  abort: () => void
  /** 把已结束的项从列表里摘掉，在途的不动。 */
  clearFinished: () => void
}

/** 队列自己的可变状态。收成一包是为了让每一段都能搬到模块层去写。 */
interface Queue {
  jobs: Ref<readonly UploadJob[]>
  pending: AbortController | null
  sequence: number
}

function isRunning(job: UploadJob): boolean {
  return job.status === 'waiting' || job.status === 'uploading'
}

/**
 * 改队列里的某一项。
 * @param queue 队列状态
 * @param id 这一项的本地 id
 * @param patch 要改的字段
 */
function patch(queue: Queue, id: string, patch: Partial<UploadJob>): void {
  queue.jobs.value = queue.jobs.value.map((job) =>
    job.id === id ? { ...job, ...patch } : job,
  )
}

/**
 * 把一批文件挂进队列，回刚挂进去的那几项。
 * @param queue 队列状态
 * @param kind 素材类型
 * @param files 用户挑的文件
 */
function enrol(
  queue: Queue,
  kind: AssetKind,
  files: readonly File[],
): UploadJob[] {
  const queued: UploadJob[] = files.map((file) => {
    queue.sequence += 1
    return {
      id: `upload-${queue.sequence}`,
      name: file.name,
      kind,
      sizeBytes: file.size,
      loaded: 0,
      status: 'waiting',
      error: '',
    }
  })
  queue.jobs.value = [...queue.jobs.value, ...queued]
  return queued
}

/**
 * 传一个文件，顺带把进度与结果写回队列。传成回素材，其余一律 null。
 * @param queue 队列状态
 * @param job 队列里的这一项
 * @param file 对应的文件
 * @param signal 取消信号
 */
async function runOne(
  queue: Queue,
  job: UploadJob,
  file: File,
  signal: AbortSignal,
): Promise<Asset | null> {
  patch(queue, job.id, { status: 'uploading' })
  try {
    const saved = await uploadAsset(job.kind, file, {
      signal,
      onProgress: ({ loaded }) => patch(queue, job.id, { loaded }),
    })
    patch(queue, job.id, { status: 'done', loaded: job.sizeBytes })
    return saved
  } catch (caught) {
    // 中止是用户自己按的，不是失败——那时整个队列都要没，不留一行红字
    if (signal.aborted) return null
    patch(queue, job.id, {
      status: 'failed',
      error: messageOf(caught, '上传失败，请重试'),
    })
    return null
  }
}

/**
 * 一个接一个把队列跑完。
 * ⚠ 一条失败不许中断整队：用户一次挑十个文件，其中一个超限就把后九个也丢掉，
 * 而界面上只说得出「上传失败」——他并不知道还有九个根本没试过。
 * @param queue 队列状态
 * @param queued 刚挂进去的那几项
 * @param files 与之一一对应的文件
 * @param signal 取消信号
 */
async function drain(
  queue: Queue,
  queued: readonly UploadJob[],
  files: readonly File[],
  signal: AbortSignal,
): Promise<Asset[]> {
  const saved: Asset[] = []
  for (const [index, job] of queued.entries()) {
    const file = files[index]
    if (file === undefined || signal.aborted) break
    const asset = await runOne(queue, job, file, signal)
    if (asset !== null) saved.unshift(asset)
  }
  return saved
}

/** 装一个上传队列。 */
export function createUploads(): AssetUploads {
  const queue: Queue = {
    jobs: ref<readonly UploadJob[]>([]),
    pending: null,
    sequence: 0,
  }

  function abort(): void {
    queue.pending?.abort()
    queue.pending = null
    queue.jobs.value = []
  }

  async function enqueue(
    kind: AssetKind,
    files: readonly File[],
  ): Promise<Asset[]> {
    if (files.length === 0) return []
    const controller = queue.pending ?? new AbortController()
    queue.pending = controller
    const saved = await drain(
      queue,
      enrol(queue, kind, files),
      files,
      controller.signal,
    )
    if (queue.pending === controller && !controller.signal.aborted) {
      queue.pending = null
    }
    return saved
  }

  return {
    jobs: queue.jobs,
    isBusy: computed(() => queue.jobs.value.some(isRunning)),
    finishedCount: computed(
      () => queue.jobs.value.filter((job) => !isRunning(job)).length,
    ),
    enqueue,
    abort,
    clearFinished: () => {
      queue.jobs.value = queue.jobs.value.filter(isRunning)
    },
  }
}
