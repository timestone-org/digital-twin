<script setup lang="ts">
/** @fileoverview 模型重新上传：预选文件、进度与取消，保留原素材身份。 */
import { DtButton, DtFilePicker, DtNotice, DtProgress } from '@dt/ui'
import { onUnmounted, ref, watch } from 'vue'
import { replaceAssetFile } from '@/api/assets'
import type { Asset } from '@/api/assets'

const props = defineProps<{ asset: Asset }>()
const emit = defineEmits<{ replaced: [asset: Asset] }>()
const file = ref<File | null>(null)
const busy = ref(false)
const progress = ref(0)
const error = ref('')
let pending: AbortController | null = null

function cancel(): void {
  pending?.abort()
  pending = null
  busy.value = false
  file.value = null
  error.value = ''
}

function select(files: File[]): void {
  file.value = files[0] ?? null
  error.value = ''
}

async function replace(): Promise<void> {
  const selected = file.value
  if (selected === null || busy.value) return
  const controller = new AbortController()
  pending = controller
  busy.value = true
  progress.value = 0
  error.value = ''
  try {
    const saved = await replaceAssetFile(props.asset, selected, {
      signal: controller.signal,
      onProgress: ({ loaded, total }) => {
        progress.value = total > 0 ? (loaded / total) * 100 : 0
      },
    })
    if (controller.signal.aborted) return
    file.value = null
    emit('replaced', saved)
  } catch (caught) {
    if (!controller.signal.aborted)
      error.value = caught instanceof Error ? caught.message : '重新上传失败'
  } finally {
    if (pending === controller) {
      pending = null
      busy.value = false
    }
  }
}

watch(() => props.asset.id, cancel)
onUnmounted(cancel)
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <DtFilePicker
        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
        label="重新上传模型"
        size="sm"
        :disabled="busy"
        @select="select"
      />
      <template v-if="file">
        <span class="break-all text-sm">{{ file.name }}</span>
        <DtButton size="sm" :disabled="busy" @click="replace">{{
          busy ? '正在替换…' : '确认替换'
        }}</DtButton>
        <DtButton size="sm" variant="ghost" @click="cancel">取消</DtButton>
      </template>
    </div>
    <p class="m-0 text-xs text-text-secondary">
      保留名称、ID
      和大屏引用。替换后刷新大屏即可加载新模型；模型内节点或动画改名后，对应绑定需重新检查。
    </p>
    <DtProgress
      v-if="busy"
      :value="progress"
      aria-label="重新上传进度"
      show-label
    />
    <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
  </div>
</template>
