/**
 * @fileoverview 属性面板的排版规则：条件显示与分组，全部由 `configSchema` 声明驱动。
 * ⚠ `when` 判定读的是**铺过缺省之后**的配置：拿原始 `configJson` 判的话，
 * 一个没配过、缺省为 true 的开关会让依赖它的字段永远不出现。
 * ⚠ 判定还沿 `when` 链往上传递，见 `isFieldVisible`。
 */
import type { ConfigField, ConfigPreset } from '@dt/contracts'

/** 面板里的一段。 */
export interface ConfigGroup {
  title: string
  fields: readonly ConfigField[]
}

/** 没声明 `group` 的字段落在这一段。 */
const DEFAULT_GROUP = '基础'

/**
 * 这个字段现在该不该出现。
 *
 * ⚠ 判定是**沿着 `when` 链往上传递的**：`when` 只说得出一个键，而条件常常是
 * 链式的（扫光宽度 ← 开了扫光 ← 选了带花纹的风格）。只判自己那一环的话，
 * 把风格切回「素净」之后，扫光那几项仍然摆在面板上——调了没有任何变化，
 * 而两侧都不报错。凡是控制它的那个字段自己都不该出现的，它也不该出现。
 *
 * @param field 字段声明
 * @param config 铺过缺省的配置
 * @param schema 同级的全部字段；不给就只判自己那一环
 */
export function isFieldVisible(
  field: ConfigField,
  config: Record<string, unknown>,
  schema: readonly ConfigField[] = [],
): boolean {
  const byKey = new Map(schema.map((one) => [one.key, one]))
  // ⚠ 记下走过的键：清单是人写的，`a → b → a` 这种环写得出来，
  //   不记的话属性面板整个卡死，而红的是浏览器不是测试
  const seen = new Set<string>([field.key])
  let current: ConfigField | undefined = field
  while (current?.when !== undefined) {
    const condition = current.when
    if (!condition.in.includes(config[condition.key])) return false
    if (seen.has(condition.key)) return true
    seen.add(condition.key)
    current = byKey.get(condition.key)
  }
  return true
}

/**
 * 筛出当前可见的字段，再按 `group` 分段，段序即字段首次出现的顺序。
 * @param schema 模块清单的配置字段
 * @param config 铺过缺省的配置
 */
export function formGroups(
  schema: readonly ConfigField[],
  config: Record<string, unknown>,
): ConfigGroup[] {
  const groups: ConfigGroup[] = []
  const byTitle = new Map<string, ConfigField[]>()
  for (const field of schema) {
    if (!isFieldVisible(field, config, schema)) continue
    const title = field.group ?? DEFAULT_GROUP
    const bucket = byTitle.get(title)
    if (bucket === undefined) {
      const created: ConfigField[] = [field]
      byTitle.set(title, created)
      groups.push({ title, fields: created })
    } else {
      bucket.push(field)
    }
  }
  return groups
}

/**
 * 当前配置命中的预设 id 集：`preset.config` 的每个键都与 resolved 配置深比较
 * 全等才算命中。子集语义——预设之外的键不参与判定，多个预设可同时命中。
 * @param presets 清单声明的预设
 * @param resolved 铺过缺省的配置
 */
export function activePresetIds(
  presets: readonly ConfigPreset[],
  resolved: Record<string, unknown>,
): Set<string> {
  const matches = (preset: ConfigPreset): boolean =>
    Object.entries(preset.config).every(
      ([key, value]) => JSON.stringify(resolved[key]) === JSON.stringify(value),
    )
  return new Set(presets.filter(matches).map((preset) => preset.id))
}
