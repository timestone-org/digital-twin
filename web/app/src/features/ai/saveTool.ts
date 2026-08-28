/**
 * @fileoverview `dashboard.save` 的工具结果形状（docs/AI_ASSISTANT_V3_PLAN.md §2.1）。
 *
 * ⚠ 保存**必须**是一个工具：publisher 按落库的绑定组装推送计划，草稿里的绑定
 * 它一条都看不见——不保存的话，助手绑完一屏点，画面上一个数都不会变。
 * ⚠ 失败一律**抛**，尤其是 409：静默吞掉会让模型接着往下绑，而每一条都存不进去。
 */

/** 保存成功之后回给模型的东西。 */
export interface SaveToolResult {
  ok: true
  /** 落库后的行版本；取不到给 null。 */
  saved_version: number | null
  note: string
}

/** 保存动作的结论：成功与否，以及失败时那句给人看的原因。 */
export interface SaveOutcome {
  isSaved: boolean
  /** 失败原因（冲突文案优先）；没有就是 null。 */
  message: string | null
}

export interface SaveToolDeps {
  /** 页面**现有**的那条保存路径。⚠ 不许另写一套：双轴保存的顺序不变量只有那份是对的。 */
  save: () => Promise<SaveOutcome>
  /** 落库之后的行版本；取不到给 null。 */
  version: () => number | null
}

/** 保存失败又说不出原因时的兜底话。 */
const FAILED = '保存失败'

/** 保存成功之后那句话。⚠ 它要说清「保存的是整份草稿」。 */
const NOTE =
  '整份草稿已落库（含用户此前未保存的改动）；实时推送要下一拍才认得新绑的点位。'

/**
 * 跑一次保存工具。
 * @param deps 页面现有的保存路径与行版本
 */
export async function runSaveTool(deps: SaveToolDeps): Promise<SaveToolResult> {
  const outcome = await deps.save()
  if (!outcome.isSaved) throw new Error(outcome.message ?? FAILED)
  return { ok: true, saved_version: deps.version(), note: NOTE }
}
