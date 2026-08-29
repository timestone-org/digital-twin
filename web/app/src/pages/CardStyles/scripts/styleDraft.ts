/**
 * @fileoverview 编辑中的那条样式：草稿的形状，与「观感键怎么补全」这一条规矩。
 * 见 docs/CARD_STYLE_LIBRARY_DESIGN.md §1.2 与 §2.2。
 */
import type {
  CardChrome,
  CardStyle,
  ConfigField,
  ModuleManifest,
} from '@dt/contracts'
import { styleKeysOf } from '@dt/contracts'
import { configDefaults, listModules } from '@dt/modules'

/**
 * 本页覆盖哪些模块：**清单里声明了 `contentKeys` 的那些**。
 *
 * ⚠ 不写一张模块类型名单：一处模块类型字面量就意味着第三方模块永远进不来，
 * 而这类判断 typecheck 与 lint 双双放行（DASHBOARD_DESIGN §5.3 陷阱 ③，
 * 由 `moduleTypeLiterals.contract.spec.ts` 守着——它连注释里的类型名也一并拦）。
 * ⚠ 判据选 `contentKeys` 不是随手挑的：没声明它的模块说不出哪些键是观感，
 * 给它存样式只会把标题与行列表一起存进去，别人套用时整片被抹掉。
 */
export function styleCapableModules(): ModuleManifest[] {
  return listModules().filter((one) => one.contentKeys !== undefined)
}

/** 编辑中的一条样式。`id` 为 null 即尚未落库的新样式。 */
export interface StyleDraft {
  id: string | null
  name: string
  description: string
  /** null = 通用外壳样式，此时不摆内芯段。 */
  moduleType: string | null
  chrome: CardChrome
  config: Record<string, unknown>
}

/**
 * 这个模块的观感字段，按 `configSchema` 的书写序。
 *
 * ⚠ 内容字段是**滤掉**不是禁用：一个存不进样式的输入框摆在那儿，用户改了它、
 * 存了、再套用时发现没生效，只会以为这一页坏了。
 * @param manifest 模块清单；缺席则没有内芯段
 */
export function styleFields(
  manifest: ModuleManifest | null,
): readonly ConfigField[] {
  if (manifest === null) return []
  const keys = new Set(styleKeysOf(manifest))
  return manifest.configSchema.filter((field) => keys.has(field.key))
}

/**
 * 把这个模块的观感键**补全**到内芯里，缺的按字段缺省补。
 *
 * ⚠ 存样式那一刻必须补全：套用是浅合并，样式里少写一个键，上一套留在
 * `config_json` 里的那个取值就原样残留——用户看到的是「换了样式但没换干净」，
 * 而两侧都不报错（CARD_STYLE_LIBRARY_DESIGN §2.2）。用户不可能记得写全三十个键，
 * 所以这件事由这一页做。
 * @param manifest 模块清单；缺席则原样返回
 * @param config 用户改过的那几个键
 */
export function fillStyleKeys(
  manifest: ModuleManifest | null,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const fields = styleFields(manifest)
  if (fields.length === 0) return {}
  const filled = { ...configDefaults(fields) }
  for (const field of fields) {
    if (field.key in config) filled[field.key] = config[field.key]
  }
  return filled
}

/**
 * 一条新样式的草稿。
 * @param moduleType 绑哪个模块；null = 通用外壳样式
 * @param manifest 该模块的清单，用于铺内芯缺省
 */
export function newDraft(
  moduleType: string | null,
  manifest: ModuleManifest | null,
): StyleDraft {
  return {
    id: null,
    name: '',
    description: '',
    moduleType,
    chrome: {},
    config: moduleType === null ? {} : fillStyleKeys(manifest, {}),
  }
}

/**
 * 库里的一条样式 → 草稿。
 * ⚠ 两袋都浅拷一份：直接引用的话，右栏改一个旋钮会顺手改掉列表里那条的取值，
 * 于是「取消」之后列表上显示的仍是改过的样子。
 * @param style 库里的样式
 */
export function draftOf(style: CardStyle): StyleDraft {
  return {
    id: style.id,
    name: style.name,
    description: style.description ?? '',
    moduleType: style.moduleType,
    chrome: { ...style.chrome },
    config: { ...style.config },
  }
}

/**
 * 两条草稿是否等值——顶栏的「保存」按不按得亮看它。
 * ⚠ 逐字段比而不是比 JSON 串：对象键序在浅拷之后并不保证一致，比串会把
 * 没改过的草稿判成改过的，保存按钮于是永远亮着。
 * @param left 一条草稿
 * @param right 另一条草稿
 */
export function sameDraft(left: StyleDraft, right: StyleDraft): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.description === right.description &&
    left.moduleType === right.moduleType &&
    sameBag(left.chrome, right.chrome) &&
    sameBag(left.config, right.config)
  )
}

function sameBag(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
  }
  return true
}
