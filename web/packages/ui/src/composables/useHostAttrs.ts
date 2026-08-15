/**
 * @fileoverview 关掉 `inheritAttrs` 的控件怎么分派透传属性：`class` / `style` 归外壳，
 * 其余原生属性归里面那个原生元素。
 * ⚠ 不分派的话两者会跟着 `$attrs` 一起落到 `<input>` 上——调用方写的 `class="w-72"`
 * 只改窄了里面的输入框、外壳仍是原宽，表现就是「样式写了不生效」。
 */
import { computed, useAttrs } from 'vue'
import type { ComputedRef, StyleValue } from 'vue'

/** `class` 的全部合法写法：串、对象、以及它们的嵌套数组。 */
export type ClassValue =
  string | undefined | Record<string, boolean | undefined> | ClassValue[]

export interface HostAttrs {
  /** 挂到外壳上的 class。 */
  hostClass: ComputedRef<ClassValue>
  /** 挂到外壳上的行内样式。 */
  hostStyle: ComputedRef<StyleValue | undefined>
  /** 除 class / style 外的透传属性，挂到里面的原生元素上。 */
  nativeAttrs: ComputedRef<Record<string, unknown>>
}

/** class 的取值是自由 JSON 形状，逐层收窄到 `ClassValue`；认不出的一律当没写。 */
function toClassValue(value: unknown): ClassValue {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(toClassValue)
  if (typeof value === 'object' && value !== null) {
    const record: Record<string, boolean | undefined> = {}
    for (const [key, flag] of Object.entries(value)) {
      record[key] = flag === true
    }
    return record
  }
  return undefined
}

/**
 * style 只放行「串」与「键值对象」两种写法。
 * 数组写法（`:style="[a, b]"`）在这些控件上没有用例，放行它就要把每一项再收窄一遍。
 */
function toStyleValue(value: unknown): StyleValue | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record: Record<string, string> = {}
    for (const [key, cell] of Object.entries(value)) {
      if (typeof cell === 'string') record[key] = cell
      else if (typeof cell === 'number') record[key] = String(cell)
    }
    return record
  }
  return undefined
}

/** 把 `$attrs` 拆成「外壳的 class / style」与「原生元素的其余属性」两份。 */
export function useHostAttrs(): HostAttrs {
  const attrs = useAttrs()
  return {
    hostClass: computed(() => toClassValue(attrs.class)),
    hostStyle: computed(() => toStyleValue(attrs.style)),
    nativeAttrs: computed(() => {
      const rest: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(attrs)) {
        if (key !== 'class' && key !== 'style') rest[key] = value
      }
      return rest
    }),
  }
}
