/** @fileoverview 只保留当前页和已选项的目录名称，标识始终以节点配置为准。 */
import type { ModelingBdmCatalogItem } from '@dt/contracts'
import { computed, ref, watch } from 'vue'

export function useBdmSelection(
  kind: () => string,
  items: () => readonly ModelingBdmCatalogItem[],
  identifiers: () => readonly string[],
) {
  const known = ref(new Map<string, ModelingBdmCatalogItem>())
  watch(
    [kind, items, identifiers],
    ([nextKind], [previousKind]) => {
      const keep =
        nextKind === previousKind
          ? known.value
          : new Map<string, ModelingBdmCatalogItem>()
      const incoming = items()
      const allowed = new Set([
        ...identifiers(),
        ...incoming.map((item) => item.identifier),
      ])
      known.value = new Map([
        ...[...keep].filter(([key]) => allowed.has(key)),
        ...incoming.map((item): [string, ModelingBdmCatalogItem] => [
          item.identifier,
          item,
        ]),
      ])
    },
    { immediate: true },
  )
  function remember(item: ModelingBdmCatalogItem): void {
    known.value = new Map(known.value).set(item.identifier, item)
  }
  return {
    remember,
    selected: computed(() =>
      identifiers().map((identifier) => ({
        identifier,
        name: known.value.get(identifier)?.name ?? identifier,
        code: known.value.get(identifier)?.code ?? identifier,
        unit: known.value.get(identifier)?.unit,
        hasName: known.value.has(identifier),
      })),
    ),
  }
}
