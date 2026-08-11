/**
 * @fileoverview 权限码的展示序。字典序让同资源前缀天然聚簇，且零请求、
 * 顺序稳定——后端返回顺序不可信（内置角色是排序后的，自建角色是声明序）。
 */

/** 排好序的副本；入参不动，免得勾选反写进列表数据。 */
export function sortCodes(codes: readonly string[]): string[] {
  return [...codes].sort()
}
