/**
 * @fileoverview 助手写一条绑定时，那条绑定的**取数方式**从工具入参里怎么读。
 *
 * ⚠ 一份而不是每个工作面各写一份：大屏与孪生两边都实现 `dashboard.write_binding`，
 * 而「常量写不写得下去」「null 算不算值」这两条口径一旦漂开，同一句话在两页上
 * 的行为就不一样了，且两边代码单看都对。
 *
 * ⚠ 助手只写 `opcua` 与 `static` 两种。`archive` / `dataset` 还要跟一份取数范围
 * （时间窗、台账列身份），少给一格的绑定存得下去、永远取不到数——那与「台账里
 * 这一格确实是空」长得一模一样。要接那两种，让用户走绑点面板。
 */
import type { AssistantToolCall, BindingPayload } from '@dt/contracts'

/** 助手写得了的两种来源。 */
export type WritableSourceKind = 'opcua' | 'static'

/**
 * 按入参把一条绑定改成它要的取数方式。
 * ⚠ 传进来的 `base` 必须是**已有的那一条**（有就用它），绑定 id 是实时推送的
 * 关联键，重生成会让关联每次保存断一次。
 * @param base 已有的那条绑定，或新建的一条
 * @param call 模型下发的调用
 */
export function withSource(
  base: BindingPayload,
  call: AssistantToolCall,
): BindingPayload {
  return sourceKindOf(call) === 'static'
    ? asConstant(base, call)
    : asPoint(base, call)
}

/** 接实时点位。 */
function asPoint(
  base: BindingPayload,
  call: AssistantToolCall,
): BindingPayload {
  return {
    ...base,
    sourceKind: 'opcua',
    nodeKey: textArg(call, 'node_key'),
    staticValueJson: null,
  }
}

/**
 * 写一个固定值。
 * ⚠ `null` 在取数那一层的口径是「没配过」而不是「值是空」——写下去的表现是
 * 这一格显示取不到，而助手会以为自己配好了。所以当场拒。
 * ⚠ `0` / `false` / `''` 都是合法常量，别按真假判。
 */
function asConstant(
  base: BindingPayload,
  call: AssistantToolCall,
): BindingPayload {
  const value = call.arguments.value
  if (value === undefined || value === null) {
    throw new Error('写常量要给 value，且不能是 null')
  }
  return {
    ...base,
    sourceKind: 'static',
    nodeKey: null,
    staticValueJson: value,
  }
}

/** 取数来源；不给就是接点位。认不出的一律直说，不要默默当成点位。 */
function sourceKindOf(call: AssistantToolCall): WritableSourceKind {
  const given: unknown = call.arguments.source_kind
  if (given === undefined || given === 'opcua') return 'opcua'
  if (given === 'static') return 'static'
  const named = typeof given === 'string' ? given : '这个'
  throw new Error(`助手只写得了 opcua 与 static 两种来源，不认识 ${named}`)
}

function textArg(call: AssistantToolCall, name: string): string {
  const given = call.arguments[name]
  if (typeof given !== 'string' || given === '') {
    throw new Error(`${call.name} 少了参数 ${name}`)
  }
  return given
}
