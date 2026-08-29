/**
 * @fileoverview 清单里的演示值 → 一组 `static` 绑定。模块库缩略图这类
 * **不连实时数据**的地方靠它把 `ModulePreview.values` 喂进正常的求值链。
 *
 * ⚠ 不新开一条注入口而是造绑定：走的是与画布同一条求值链，模块因此看到的
 * `values` 与 `meta.slots` 与真跑起来时逐字同形。另开一条「直接塞 values」的
 * 后门，预览就会在状态四档上与运行态分叉——而那正是预览要验的东西。
 *
 * ⚠ 住在应用侧而不是 `@dt/runtime`：运行时对**来源种类无感知**是它的一条硬规矩
 * （DASHBOARD_DESIGN §5.5，由 `sourceLiterals.contract.spec.ts` 守着），
 * 而这里非写 `sourceKind: 'static'` 不可。认识来源种类的那一层在应用里。
 */
import type { BindingSpec, BindingView, ModulePreview } from '@dt/contracts'

/** 演示绑定的 id 前缀。⚠ 不用随机 id：同一份清单每次算出来必须一样，否则整树重挂。 */
const PREVIEW_ID = 'preview'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 一条常量绑定。
 * @param fieldKey 槽键，数组槽形如 `rows[0].value`
 * @param value 演示值
 */
function staticBinding(fieldKey: string, value: unknown): BindingView {
  return {
    id: `${PREVIEW_ID}:${fieldKey}`,
    fieldKey,
    sourceKind: 'static',
    nodeKey: null,
    staticValueJson: value,
    computeJson: null,
    detailJson: null,
    transformJson: null,
  }
}

/**
 * 把一个数组槽的演示值摊成逐行绑定。
 * 行是对象就按子槽摊开（`rows[0].value`），是标量就整行一条（`rows[0]`）。
 * @param key 槽键
 * @param rows 演示值里的那个数组
 */
function arrayBindings(key: string, rows: readonly unknown[]): BindingView[] {
  return rows.flatMap((row, index) => {
    if (!isRecord(row)) return [staticBinding(`${key}[${index}]`, row)]
    return Object.entries(row).map(([sub, value]) =>
      staticBinding(`${key}[${index}].${sub}`, value),
    )
  })
}

/**
 * 清单的演示值摊成一组常量绑定，槽键与真绑定同形。
 *
 * ⚠ 只认清单声明过的槽：`preview.values` 是人手写的，键写错了在这里被丢掉，
 * 而不是造出一条永远喂不到任何模块的绑定。
 * ⚠ 值为 `undefined` / `null` 的槽不造绑定：常量绑定的读取器把它判成
 * 「没配常量值」的 error，预览上会画成一格红字，而作者的本意是「这一槽留空」。
 *
 * @param specs 模块清单声明的绑定槽
 * @param preview 清单的 `preview` 段
 */
export function previewBindings(
  specs: readonly BindingSpec[],
  preview: ModulePreview | undefined,
): BindingView[] {
  const values = preview?.values
  if (values === undefined) return []
  return specs.flatMap((spec) => {
    const value = values[spec.key]
    if (value === undefined || value === null) return []
    if (spec.isArray === true && Array.isArray(value)) {
      return arrayBindings(spec.key, value)
    }
    return [staticBinding(spec.key, value)]
  })
}
