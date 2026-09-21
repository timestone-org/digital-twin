<script setup lang="ts">
/** @fileoverview 知识库管理页的品牌引导横幅。 */
import KnowledgeMascot from './KnowledgeMascot.vue'
</script>

<template>
  <section class="knowledge-guide" aria-label="知识库指南">
    <KnowledgeMascot scene="library" compact />
    <div class="knowledge-guide__copy">
      <p>知识在这里汇聚</p>
      <h2>把经验存下来，让答案找得到</h2>
      <span>汇集手册、规程与业务资料，为每一次提问提供依据。</span>
    </div>
    <ol class="knowledge-guide__steps" aria-label="使用步骤">
      <li><b>01</b> 选择知识库</li>
      <li><b>02</b> 上传资料</li>
      <li><b>03</b> 检索与提问</li>
    </ol>
  </section>
</template>

<style scoped lang="scss">
.knowledge-guide {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-shrink: 0;
  padding: 0.75rem 1.5rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: linear-gradient(
    110deg,
    rgba(var(--accent-primary-rgb), 0.09),
    var(--surface-panel) 65%
  );
  &__copy {
    flex: 1;
    min-width: 0;
  }
  p {
    margin: 0 0 0.35rem;
    color: var(--accent-primary);
    font-size: 0.6875rem;
    letter-spacing: 0.15em;
  }
  h2 {
    margin: 0 0 0.375rem;
    color: var(--text-title);
    font-size: 1.125rem;
    font-weight: 600;
  }
  span {
    color: var(--text-secondary);
    font-size: 0.75rem;
  }
  &__steps {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-secondary);
    font-size: 0.75rem;
  }
  li {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-pill);
  }
  b {
    margin-right: 0.4rem;
    color: var(--accent-primary);
    font-weight: 500;
  }
}
@media (max-width: 1100px) {
  .knowledge-guide__steps {
    display: none;
  }
}
@media (max-width: 640px) {
  .knowledge-guide {
    padding: 0.75rem;
    gap: 0.5rem;
  }
  .knowledge-guide h2 {
    font-size: 0.9375rem;
  }
  .knowledge-guide :deep(.knowledge-mascot) {
    width: 4.5rem;
  }
}
</style>
