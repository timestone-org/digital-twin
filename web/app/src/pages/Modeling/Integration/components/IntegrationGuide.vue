<script setup lang="ts">
/** @fileoverview 第三方按模板建模的接入说明与完整参数示例。 */
import { DtCard, DtIcon, DtNotice, DtTag } from '@dt/ui'
import { RouterLink } from 'vue-router'
const steps = [
  [
    '1. 选择模板',
    'GET /modeling-templates?page=1&size=20',
    '选取 is_enabled=true 的具体模板版本，保存其 id。',
  ],
  [
    '2. 获取全部配置',
    'GET /modeling-templates/{template_id}/configuration',
    'configuration 是完整默认参数，json_schema 是可直接用于校验的 JSON Schema，nodes 包含每个算子的说明与输入输出端口。',
  ],
  [
    '3. 创建模型',
    'POST /modeling-instances',
    '提交 template_id、唯一 code、name，可同时提交修改后的完整 configuration。',
  ],
  [
    '4. 一次配置所有参数',
    'PUT /modeling-instances/{id}/configuration',
    '提交 expected_revision 和完整 configuration。读取实例取得 revision；400 表示配置错误，409 表示版本冲突或仍在训练。',
  ],
  [
    '5. 训练与查询结果',
    'POST /modeling-instances/{id}:train',
    '请求体 {"trigger":"api"}，返回 202。通过 GET /modeling-runs/{run_id} 查询，成功状态为 succeeded；可通过 :cancel 取消。',
  ],
  [
    '6. 发布模型版本',
    'POST /modeling-model-versions',
    '提交成功训练的 run_id 和 name。响应 signature 为实际输入输出签名，is_servable=true 的版本才能部署。',
  ],
  [
    '7. 部署模型',
    'POST /modeling-instances/{id}:deploy',
    '提交 model_version_id、服务 code 和 name。部署完成后即可使用用户 APIKey 调用。',
  ],
  [
    '8. 调用服务',
    'GET /open-models/{code}',
    '使用用户 APIKey 读取签名，再按任务类型调用 :predict、:detect 或 :calculate。',
  ],
]
const example = JSON.stringify(
  {
    expected_revision: 1,
    configuration: {
      nodes: {
        source: {
          table_code: 'chiller-01',
          columns: ['temperature', 'load', 'energy'],
          since: '',
          until: '',
        },
        split: {
          target_column: 'energy',
          test_ratio: 0.2,
          method: 'time_order',
        },
        model: { use_intercept: true },
      },
    },
  },
  null,
  2,
)
</script>
<template>
  <div class="integration-body">
    <div class="integration-entry">
      <DtCard
        title="模板准备"
        subtitle="将流程图发布为固定版本，供第三方选择"
        icon="layers"
      >
        <p>
          在建模工作台完成设计与验证后，使用「发布为模板」。每个接入实例独立保存参数。
        </p>
        <template #footer>
          <RouterLink to="/modeling/templates">
            管理已发布模板 <DtIcon name="arrow-right" :size="14" />
          </RouterLink>
        </template>
      </DtCard>
      <DtCard
        title="接入验证"
        subtitle="查看快捷建模的使用效果与实例状态"
        icon="workflow"
      >
        <p>
          集中查看实例配置、训练记录与部署结果，验证第三方的创建和更新流程。
        </p>
        <template #footer>
          <RouterLink to="/modeling/instances">
            查看接入实例 <DtIcon name="arrow-right" :size="14" />
          </RouterLink>
        </template>
      </DtCard>
    </div>
    <DtNotice intent="info">
      所有路径前缀为 /api/v1/platform。建模管理与线上调用统一使用 Authorization:
      Bearer &lt;用户 APIKey&gt;。仅调用模型需要 modeling:view 权限。
      专用账号授予 modeling:view、modeling:run，需要部署时增加
      modeling:publish，无需 modeling:manage。
    </DtNotice>
    <DtCard
      title="获取全部已部署模型"
      subtitle="从部署列表选择服务，再读取签名并调用"
    >
      <code>GET /modeling-deployments</code>
      <p>
        使用用户 APIKey，账号需有 modeling:view 权限。返回 data
        数组，包含全部部署，无需分页；没有部署时返回空数组。
      </p>
      <p>
        列表包含名称、code、固定模型版本、状态和配额。选择 is_enabled=true 且
        is_servable=true 的项，再通过 GET /open-models/{code}
        读取输入输出签名。停用或不可服务的部署仍会出现在列表中。
      </p>
    </DtCard>
    <div class="integration-content">
      <ol class="integration-steps" aria-label="第三方接入流程">
        <li v-for="step in steps" :key="step[0]">
          <DtCard :title="step[0]" padding="sm">
            <DtTag intent="info">{{ step[1]?.split(' ')[0] }}</DtTag>
            <code>{{
              ' ' + (step[1]?.split(' ').slice(1).join(' ') ?? '')
            }}</code>
            <p>{{ step[2] }}</p>
          </DtCard>
        </li>
      </ol>
      <aside class="integration-example">
        <DtCard
          title="完整参数示例"
          subtitle="更新前先读取实例的当前 revision"
          icon="settings"
        >
          <DtNotice intent="warning">
            以下仅展示请求结构。节点 ID 和参数必须来自所选模板返回的
            configuration，不能把示例节点直接用于其他模板。保存配置会替换全部节点参数。
          </DtNotice>
          <pre><code>{{ example }}</code></pre>
          <p>
            创建与训练请求带
            Idempotency-Key，同一逻辑请求使用同一个键。训练失败读取
            error_text，修正配置后使用新键重新训练。
          </p>
          <template #footer>
            模板新版本不会自动升级已有模型，重新训练也不会替换已部署版本。
          </template>
        </DtCard>
      </aside>
    </div>
  </div>
</template>
<style scoped lang="scss">
.integration-body {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-bottom: 1rem;
}
.integration-entry {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.integration-content {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.integration-steps {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.integration-example {
  position: sticky;
  top: 0;
  min-width: 0;
}
code {
  font-family: var(--font-mono);
  font-size: var(--font-size-caption);
  color: var(--accent-primary);
  overflow-wrap: anywhere;
}
.integration-steps code {
  margin-left: 0.5rem;
}
p {
  color: var(--text-secondary);
  margin: 0.65rem 0 0;
  line-height: var(--line-height-body);
}
a {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--accent-primary);
}
pre {
  margin: 1rem 0;
  padding: 1rem;
  overflow: auto;
  background: var(--surface-sunken);
  border-radius: var(--radius-md);
}
@media (width < 64rem) {
  .integration-content,
  .integration-entry {
    grid-template-columns: minmax(0, 1fr);
  }
  .integration-example {
    position: static;
  }
}
</style>
