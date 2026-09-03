<script setup lang="ts">
/**
 * @fileoverview 引用里的一条：角标 + 位置，点开是原文与那几张图。
 *
 * ⚠ 单拎成一个件是为了让父件的模板嵌套不超过 6 层（闸门守着）。它同时也让
 * 「一条引用长什么样」有了一个可以单测的落点。
 *
 * ⚠ 图**不能把端点地址写进 `<img src>`**：浏览器给图片请求带不上
 * `Authorization`，而知识库的图要认人（与素材那条匿名可读的 `/oss/` 不同）。
 * 写进 src 的表现是整张图 401、界面上一个碎图标，且不报任何错。所以这里取
 * 字节、转 object URL，并在卸载与收起时 revoke。
 */
import { onUnmounted, ref, watch } from 'vue'
import { DtIcon } from '@dt/ui'
import type { KnowledgeCitation } from '@dt/contracts'

import { readFigureBytes } from '@/api/knowledge'
import { useRacedFetch } from '@/composables/useRacedFetch'

const props = defineProps<{ item: KnowledgeCitation }>()

/** ⚠ 默认收起：依据是给要核对的人看的，摊开会把答案挤到屏幕外。 */
const isOpen = ref(false)
/** 图 id → 这一张的 object URL。取不回来的那一张不在表里，于是不渲染。 */
const shown = ref<Record<string, string>>({})
/** ⚠ 快速开合会让先发的那一次后返回：走统一的竞态防护，不手搓序号。 */
const race = useRacedFetch()

/** 放掉手上全部的 object URL。⚠ 不放的话每翻一条依据就漏一批。 */
function release(): void {
  for (const url of Object.values(shown.value)) URL.revokeObjectURL(url)
  shown.value = {}
}

/** 取回这一条引用带的那几张图的字节。 */
async function fetched(signal: AbortSignal): Promise<[string, Blob][]> {
  const made: [string, Blob][] = []
  for (const figure of props.item.figures) {
    try {
      made.push([
        figure.id,
        await readFigureBytes(props.item.document_id, figure.id, signal),
      ])
    } catch {
      // 取不回来的那一张就不摆出来。⚠ 不弹错：一张图取不到不该盖住答案
    }
  }
  return made
}

watch(isOpen, (open) => {
  if (!open) {
    race.cancel()
    release()
    return
  }
  void race.run(fetched, {
    ok: (got) => {
      shown.value = Object.fromEntries(
        got.map(([id, blob]) => [id, URL.createObjectURL(blob)]),
      )
    },
    fail: () => undefined,
    settled: () => undefined,
  })
})

onUnmounted(() => {
  race.cancel()
  release()
})
</script>

<template>
  <li>
    <button
      type="button"
      class="cites__row"
      :aria-expanded="isOpen"
      @click="isOpen = !isOpen"
    >
      <span class="cites__mark">{{ item.marker }}</span>
      <span class="cites__where">{{ item.where }}</span>
      <DtIcon
        :name="isOpen ? 'chevron-down' : 'chevron-right'"
        :size="13"
        class="cites__fold"
      />
    </button>
    <div v-if="isOpen" class="cites__body">
      <p class="cites__text">{{ item.text }}</p>
      <figure v-for="fig in item.figures" :key="fig.id" class="cites__figure">
        <img
          v-if="shown[fig.id]"
          :src="shown[fig.id]"
          :alt="fig.caption || '资料里的一张图'"
        />
        <figcaption v-if="fig.caption">{{ fig.caption }}</figcaption>
      </figure>
    </div>
  </li>
</template>

<style scoped lang="scss">
.cites__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.1875rem 0.25rem;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  text-align: left;
  cursor: pointer;
}

.cites__row:hover {
  background: var(--surface-raised);
}

/* 角标：与正文里那个字符同一个字形，靠颜色认出来它是可点的 */
.cites__mark {
  flex: none;
  color: var(--accent-primary);
  font-size: 0.875rem;
}

.cites__where {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cites__fold {
  flex: none;
  color: var(--text-disabled);
}

.cites__body {
  margin: 0 0 0.375rem 1.5rem;
  padding-left: 0.5rem;
  border-left: 1px solid var(--border-default);
}

.cites__text {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.75rem;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cites__figure {
  margin: 0.375rem 0 0;
}

.cites__figure img {
  display: block;
  max-width: min(100%, 22rem);
  height: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}

.cites__figure figcaption {
  padding-top: 0.1875rem;
  color: var(--text-disabled);
  font-size: 0.6875rem;
}
</style>
