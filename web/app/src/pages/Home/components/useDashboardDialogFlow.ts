/**
 * @fileoverview 大屏那几个弹窗的落库：建屏（三种起手方式）、读导入包、导入、
 * 跑一次自检。事件由聚合组件发，这里只管请求、忙碌态与提示。
 *
 * ⚠ 建屏与导入都可能回一串接不上的绑定，所以结果留在 `created` 里等着被摆出来，
 * 而不是跑完就丢——静默咽掉会让人以为拿到的是一张能用的屏。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useToast } from '@dt/ui'
import type { DashboardExportPayload, UnresolvedBinding } from '@dt/contracts'

import { validateDashboard, type ValidationReport } from '@/api/dashboard'
import { describeError } from '@/composables/useAsyncList'
import type { NewDashboardPayload } from '../payloads'
import {
  createDashboardFrom,
  importInto,
  readExportFile,
  type CreatedDashboard,
  type ImportChoice,
} from './workbenchWrites'

export interface DashboardDialogFlow {
  busy: Ref<boolean>
  validating: Ref<boolean>
  validation: Ref<ValidationReport | null>
  /** 选好并解析成功的导入包；没选或已用掉时为 null。 */
  payload: Ref<DashboardExportPayload | null>
  /** 最近一次建屏 / 导入的结果，供未解析绑定弹窗与「去预览」用。 */
  created: Ref<CreatedDashboard | null>
  unresolved: ComputedRef<UnresolvedBinding[]>
  pick: (file: File) => Promise<void>
  clearPayload: () => void
  dismiss: () => void
  create: (input: NewDashboardPayload) => Promise<boolean>
  runImport: (projectId: string, choice: ImportChoice) => Promise<boolean>
  validate: (dashboardId: string) => Promise<void>
}

interface Context {
  toast: ReturnType<typeof useToast>
  busy: Ref<boolean>
  created: Ref<CreatedDashboard | null>
  payload: Ref<DashboardExportPayload | null>
}

/** 建成的屏记在 `created` 里：未解析绑定要接着它弹。 */
async function build(
  context: Context,
  task: () => Promise<CreatedDashboard>,
): Promise<boolean> {
  context.busy.value = true
  try {
    const made = await task()
    context.created.value = made
    context.toast.success(`已创建「${made.name}」`)
    return true
  } catch (caught) {
    context.toast.error(describeError(caught))
    return false
  } finally {
    context.busy.value = false
  }
}

/** 读文件失败不清掉已选的包：用户可以再选一次，不必从头开。 */
async function pick(context: Context, file: File): Promise<void> {
  try {
    context.payload.value = await readExportFile(file)
  } catch (caught) {
    context.toast.error(describeError(caught))
  }
}

async function runImport(
  context: Context,
  projectId: string,
  choice: ImportChoice,
): Promise<boolean> {
  const packed = context.payload.value
  if (packed === null) return false
  const done = await build(context, () => importInto(projectId, packed, choice))
  if (done) context.payload.value = null
  return done
}

export function useDashboardDialogFlow(): DashboardDialogFlow {
  const context: Context = {
    toast: useToast(),
    busy: ref(false),
    created: ref<CreatedDashboard | null>(null),
    payload: ref<DashboardExportPayload | null>(null),
  }
  const validating = ref(false)
  const validation = ref<ValidationReport | null>(null)

  /** 跑一次自检。失败也要收尾，否则弹窗会一直停在转圈上。 */
  async function validate(dashboardId: string): Promise<void> {
    validating.value = true
    validation.value = null
    try {
      validation.value = await validateDashboard(dashboardId)
    } catch (caught) {
      context.toast.error(describeError(caught))
    } finally {
      validating.value = false
    }
  }

  return {
    busy: context.busy,
    validating,
    validation,
    payload: context.payload,
    created: context.created,
    unresolved: computed(() => context.created.value?.unresolvedBindings ?? []),
    pick: (file) => pick(context, file),
    clearPayload: () => {
      context.payload.value = null
    },
    dismiss: () => {
      context.created.value = null
    },
    create: (input) => build(context, () => createDashboardFrom(input)),
    runImport: (projectId, choice) => runImport(context, projectId, choice),
    validate,
  }
}
