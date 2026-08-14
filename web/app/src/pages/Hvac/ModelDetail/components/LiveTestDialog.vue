<script setup lang="ts">
/**
 * @fileoverview 实时测试：按房间当下的实时工况，比较各个开机组合要等多久。
 *
 * ⚠ 打开即取数即推荐，用户不用点第二次——这是这个弹窗存在的全部意义。
 * ⚠ 结论在上、依据在下；但读数的新鲜度是结论的**有效性前提**，所以「陈旧 /
 * 缺数 / 用的是旧工件」提成顶部的提示，逐台读数留在下面供核对。
 * ⚠ 两颗动作键语义不同不许合并：footer 那颗重新取数，调整区那颗不取数。
 */
import { computed, watch } from 'vue'
import type { AcModel, AcUnitReadingValues } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSkeleton,
  DtSpinner,
  DtTag,
} from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import { liveTestNotices } from '@/features/hvac/liveTest'
import { isModelBusy } from '@/features/hvac/modelView'
import { formatTimeAt } from '@/utils/datetime'
import LiveReadingsTable from './LiveReadingsTable.vue'
import RecommendEntryCard from './RecommendEntryCard.vue'
import { useLiveTest } from '../useLiveTest'

const props = defineProps<{ open: boolean; model: AcModel | null }>()

const emit = defineEmits<{ close: []; retrain: [] }>()

const live = useLiveTest(() => props.model)

watch(
  () => props.open,
  (open) => (open ? live.start() : live.stop()),
)

const notices = computed(() =>
  liveTestNotices({
    isRetraining:
      props.model !== null &&
      isModelBusy(props.model) &&
      props.model.trained_at !== null,
    isLastTrainingFailed:
      props.model?.status === 'failed' && props.model.trained_at !== null,
    isModelRetrained: live.isModelRetrained.value,
    resultEdited: live.resultEdited.value,
    resultBlind: live.result.value !== null && live.resultBlind.value,
    staleCount: live.staleCount.value,
    staleMinutes: live.staleMinutes.value,
    missingCount: live.missingCount.value,
    allMissing: live.allMissing.value,
  }),
)

const asOfText = computed(() => {
  const got = live.readings.value
  if (got === null) return ''
  return `取数于 ${formatTimeAt(got.as_of)} · 回看 ${got.lookback_minutes} 分钟`
})

const setCount = computed(() => props.model?.serving_sets.length ?? 0)
/** 结论区有话可说才渲染标题，免得 E1 下杵一个空的「组合建议」。 */
const hasVerdict = computed(
  () =>
    live.recommending.value ||
    live.recommendProblem.value !== null ||
    live.result.value !== null,
)

function onEdit(
  serial: string,
  key: keyof AcUnitReadingValues,
  value: number | null,
): void {
  const current = live.draft.value[serial]
  if (current === undefined) return
  live.draft.value = {
    ...live.draft.value,
    [serial]: { ...current, [key]: value },
  }
}
</script>

<template>
  <DtModal
    :model-value="props.open"
    title="实时测试"
    description="按房间当前的实时工况，比较各个开机组合要等多久"
    width="48rem"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <template v-if="live.loadingReadings.value">
        <p class="flex items-center gap-2 text-xs text-text-secondary">
          <DtSpinner :size="14" />
          正在读取实时工况…
        </p>
        <DtSkeleton :lines="6" />
      </template>

      <template v-else>
        <DtNotice
          v-for="notice in notices"
          :key="notice.id"
          :intent="notice.intent"
        >
          {{ notice.text }}
        </DtNotice>

        <!-- E1 / E3：取数失败。⚠ 明说不会拿旧数据顶上 -->
        <DtNotice v-if="live.readingsProblem.value" intent="danger">
          {{
            live.readingsProblem.value.kind === 'unavailable'
              ? '实时数据源现在读不到，没有可用的当前工况。这里不会拿旧数据顶上。'
              : live.readingsProblem.value.message
          }}
          <span class="ml-2 inline-flex gap-2">
            <DtButton variant="ghost" size="sm" @click="live.reload()">
              重试
            </DtButton>
            <DtButton
              variant="ghost"
              intent="neutral"
              size="sm"
              @click="live.recommend()"
            >
              仍要按未知条件试算
            </DtButton>
          </span>
        </DtNotice>

        <!-- E2：房间没绑机组，到此为止 -->
        <DtNotice v-if="live.hasNoUnits.value" intent="warning">
          这个房间还没有绑定空调机组，取不到工况。先在台账页把空调挂到这个房间上。
        </DtNotice>

        <template v-else>
          <!-- W1：窗内一台都没读到，不自动推荐 -->
          <DtNotice
            v-if="live.allMissing.value && live.result.value === null"
            intent="warning"
          >
            回看 {{ live.readings.value?.lookback_minutes ?? 15 }}
            分钟内没有任何读数——机组可能已停，也可能是采集中断。
            <DtButton
              class="ml-2"
              variant="ghost"
              intent="neutral"
              size="sm"
              @click="live.recommend()"
            >
              仍要按未知条件试算
            </DtButton>
          </DtNotice>

          <section v-if="hasVerdict" class="flex flex-col gap-2">
            <h3
              class="flex items-center gap-2 text-sm font-semibold text-text-primary"
            >
              组合建议
              <DtTag v-if="live.resultEdited.value" size="sm" intent="warning">
                已手动调整
              </DtTag>
            </h3>

            <p
              v-if="live.recommending.value"
              class="flex items-center gap-2 text-xs text-text-secondary"
            >
              <DtSpinner :size="14" />
              正在比较 {{ setCount }} 个组合…
            </p>

            <!-- E4：工件里没有这些机组；E5：其它推荐失败 -->
            <DtNotice v-else-if="live.recommendProblem.value" intent="danger">
              {{
                live.recommendProblem.value.kind === 'unknownUnits'
                  ? '模型工件里没有这些机组（多半是训练之后新加的），所有服务组合都算不了。重训模型后即可使用。'
                  : live.recommendProblem.value.message
              }}
              <PermGuard
                v-if="live.recommendProblem.value.kind === 'unknownUnits'"
                :codes="[PERMISSION_CODES.acManage]"
              >
                <DtButton
                  class="ml-2"
                  variant="ghost"
                  size="sm"
                  @click="emit('retrain')"
                >
                  去重训
                </DtButton>
              </PermGuard>
              <DtButton
                v-else
                class="ml-2"
                variant="ghost"
                size="sm"
                @click="live.recommend()"
              >
                重试推荐
              </DtButton>
            </DtNotice>

            <template v-else-if="live.result.value">
              <RecommendEntryCard
                v-for="entry in live.result.value.items"
                :key="entry.set_key"
                :entry="entry"
              />
              <!-- ⚠ 缺席的组合必须列出来：静默少几行 = 用户以为那些组合不存在 -->
              <DtNotice
                v-if="live.missingSets.value.length > 0"
                intent="warning"
              >
                有 {{ live.missingSets.value.length }} 个服务组合没有出数：{{
                  live.missingSets.value.join('、')
                }}
                —— 模型工件里没有这些机组，重训后可比。
              </DtNotice>
            </template>
          </section>

          <section
            v-if="live.readings.value"
            class="flex flex-col gap-2 border-t border-border-subtle pt-3"
          >
            <p class="text-xs text-text-secondary">{{ asOfText }}</p>
            <LiveReadingsTable
              :units="live.units.value"
              :as-of="live.readings.value.as_of"
              :now="live.now.value"
              :draft="live.draft.value"
              :is-tuning="live.isTuning.value"
              @edit="onEdit"
            />
            <DtNumberInput
              v-model="live.idleMinutes.value"
              label="全停时长（分钟，可空）"
              hint="开机前房间停了多久；不知道就留空——留空按未知处理，不会当成刚停就开"
              size="sm"
              :steppers="false"
              :range="{ min: 0, max: 100000 }"
            />
            <div class="flex flex-wrap items-center justify-between gap-2">
              <DtCheckbox
                :model-value="live.isTuning.value"
                label="手动微调读数"
                @update:model-value="live.setTuning($event)"
              />
              <DtButton
                variant="outline"
                size="sm"
                :disabled="!live.canRecompute.value || live.recommending.value"
                :title="
                  live.canRecompute.value
                    ? undefined
                    : '改动全停时长或读数后可用'
                "
                @click="live.recommend()"
              >
                按调整后条件重算
              </DtButton>
            </div>
          </section>
        </template>
      </template>
    </div>

    <template #footer>
      <DtButton variant="ghost" intent="neutral" @click="emit('close')">
        关闭
      </DtButton>
      <!-- ⚠ 图标注册表里没有 refresh/reload，刷新键只用文字 -->
      <DtButton
        v-if="!live.hasNoUnits.value"
        intent="primary"
        :loading="live.loadingReadings.value || live.recommending.value"
        @click="live.reload()"
      >
        重新取数并推荐
      </DtButton>
    </template>
  </DtModal>
</template>
