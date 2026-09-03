<script setup lang="ts">
/**
 * @fileoverview 「此刻真在用什么」：两个消费方各自能力面报回来的状态。
 *
 * ⚠ 这一栏读的是助手与知识库**自己**的能力面，不是目录：目录里分配了、那一侧
 * 没跟上（目录还没刷新、或那一路密钥解不开）时，只有这里看得出来。
 * ⚠ 服务没部署时那一栏如实缺席，不算错。
 */
import type { AssistantCapability } from '@dt/contracts'
import { DtTag } from '@dt/ui'

import type { KnowledgeCapability } from '@/api/knowledge'

defineProps<{
  assistant: AssistantCapability | null
  knowledge: KnowledgeCapability | null
}>()
</script>

<template>
  <div class="grid gap-4 md:grid-cols-2">
    <section class="effective">
      <h3 class="effective__title">AI 助手</h3>
      <p v-if="assistant === null" class="effective__hint">
        这套部署没接助手，或它此刻不可达。
      </p>
      <template v-else>
        <p v-if="assistant.models.length === 0" class="effective__hint">
          一路模型都没接：给「对话」用途分配一个模型，或在环境变量里配一路。
        </p>
        <ul v-else class="effective__list">
          <li
            v-for="one in assistant.models"
            :key="one.id"
            class="effective__row"
          >
            <span class="text-text-title">{{ one.label }}</span>
            <DtTag v-if="one.id === assistant.default_model_id" size="sm">
              默认
            </DtTag>
            <DtTag :intent="one.is_ready ? 'success' : 'warning'" size="sm">
              {{ one.is_ready ? '可用' : '未登录' }}
            </DtTag>
            <span class="effective__models">{{ one.models.join('、') }}</span>
          </li>
        </ul>
      </template>
    </section>

    <section class="effective">
      <h3 class="effective__title">知识库</h3>
      <p v-if="knowledge === null" class="effective__hint">
        这套部署没接知识库，或它此刻不可达。
      </p>
      <ul v-else class="effective__list">
        <li class="effective__row">
          <span class="text-text-title">文档嵌入</span>
          <DtTag
            :intent="knowledge.isEmbeddingEnabled ? 'success' : 'warning'"
            size="sm"
          >
            {{ knowledge.isEmbeddingEnabled ? '已接' : '没接' }}
          </DtTag>
        </li>
        <li class="effective__row">
          <span class="text-text-title">对话与 agentic 检索</span>
          <DtTag
            :intent="knowledge.isModelEnabled ? 'success' : 'warning'"
            size="sm"
          >
            {{ knowledge.isModelEnabled ? '已接' : '没接' }}
          </DtTag>
        </li>
        <li class="effective__row">
          <span class="text-text-title">检索重排</span>
          <DtTag
            :intent="knowledge.rerank.isEnabled ? 'success' : 'neutral'"
            size="sm"
          >
            {{ knowledge.rerank.isEnabled ? '已接' : '没接' }}
          </DtTag>
          <!-- ⚠ 没接时把原因摆出来：不摆的话，「质量忽然变了」没有任何线索 -->
          <span class="effective__models">
            {{
              knowledge.rerank.isEnabled
                ? knowledge.rerank.model
                : knowledge.rerank.reason
            }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped lang="scss">
.effective {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-raised);
}

.effective__title {
  margin: 0;
  color: var(--text-title);
  font-size: 0.875rem;
}

.effective__hint {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.effective__list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.effective__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

.effective__models {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-secondary);
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
