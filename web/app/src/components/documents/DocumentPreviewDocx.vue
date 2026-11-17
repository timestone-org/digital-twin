<script setup lang="ts">
/** @fileoverview 共享 Word 原件预览，完成后通知宿主装配内容扩展。 */
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { renderAsync } from 'docx-preview'
import { DtSpinner } from '@dt/ui'
import { useRacedFetch } from '@/composables/useRacedFetch'

const props = defineProps<{ blob: Blob }>()
const emit = defineEmits<{ rendered: [host: HTMLElement] }>()

const host = ref<HTMLElement | null>(null)
const isLoading = ref(true)
const failure = ref('')
let isAlive = true
const raced = useRacedFetch()

async function render(blob: Blob): Promise<void> {
  isLoading.value = true
  failure.value = ''
  // ⚠ 先等一次 DOM。`immediate` 的第一次侦听是在 setup 期间**同步**跑的，
  // `flush: 'post'` 对它不生效——那一刻容器还没挂上。当时直接 return 的那一版
  // 让加载态再也不会被清掉，表现是「弹窗永远在转圈」，而控制台里一个字都没有
  await nextTick()
  const box = host.value
  if (box === null || !isAlive) {
    isLoading.value = false
    return
  }
  await raced.run(
    async () => {
      const detached = document.createElement('div')
      await renderAsync(blob, detached, undefined, {
        className: 'docx',
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        // ⚠ 见文件头：这一条是安全边界，默认值是 true
        renderAltChunks: false,
        // ⚠ 修订痕迹与批注不画：它们在版式里是彩色删除线与批注框，而预览要
        // 回答的问题是「这份资料里写了什么」，不是「谁改过哪一句」
        renderChanges: false,
        renderComments: false,
        useBase64URL: true,
      })
      return detached
    },
    {
      ok: (rendered) => {
        box.replaceChildren(...Array.from(rendered.childNodes))
        emit('rendered', box)
      },
      fail: () => {
        failure.value = '这份 Word 文档画不出来，可以下载原件后用 Word 打开。'
      },
      settled: () => {
        if (isAlive) isLoading.value = false
      },
    },
  )
}

watch(() => props.blob, render, { immediate: true })

onUnmounted(() => {
  isAlive = false
  raced.cancel()
})
</script>

<template>
  <div class="doc-docx">
    <DtSpinner v-if="isLoading" />
    <p v-if="failure !== ''" class="doc-docx__failed">{{ failure }}</p>
    <div ref="host" class="doc-docx__paper" />
  </div>
</template>

<style lang="scss">
/* ⚠ 这一段**不能 scoped**：版式是 docx-preview 在运行时插进容器的，那些节点
   没有本组件的 data-v 属性，scoped 选择器一条都命中不了。所以每一条都锁死在
   `.doc-docx` 之下，不许有一条裸的元素选择器溜出去。 */
.doc-docx {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  overflow: auto;
  background: var(--surface-sunken);

  &__failed {
    margin: auto;
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }

  /* 纸张是白的、字是黑的——那是原件自己带的颜色，不跟本站主题走 */
  .docx-wrapper {
    padding: 0;
    background: transparent;

    > section.docx {
      margin-bottom: 12px;
      box-shadow: var(--fx-shadow-menu);
    }
  }
}
</style>
