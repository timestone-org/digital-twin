<script setup lang="ts">
/** @fileoverview 第三方按模板建模的接入说明与完整参数示例。 */
import { DtNotice } from '@dt/ui'
import { AppShell } from '@/components/layout'
import ModelingNav from '../components/ModelingNav.vue'
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
    '7. 部署并取得密钥',
    'POST /modeling-instances/{id}:deploy',
    '提交 model_version_id、服务 code 和 name。再通过 POST /modeling-deployments/{id}/api-keys 签发调用密钥。',
  ],
  [
    '8. 调用服务',
    'GET /open-models/{code}',
    '使用部署密钥读取签名，再按任务类型调用 :predict、:detect 或 :calculate。',
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
  <AppShell
    title="第三方接入"
    subtitle="只需已有模板，即可配置、训练和部署模型"
  >
    <div class="flex h-full min-h-0 flex-col gap-4">
      <ModelingNav />

      <div class="integration-body">
        <DtNotice intent="info">
          所有路径前缀为 /api/v1/platform。建模管理接口使用 Authorization:
          Bearer &lt;账号 API 密钥&gt;；线上推理使用 X-Api-Key
          请求头携带独立部署密钥。专用账号授予
          modeling:view、modeling:run，需要部署时增加 modeling:publish，无需
          modeling:manage。
        </DtNotice>

        <ol class="integration-steps">
          <li v-for="step in steps" :key="step[0]">
            <h2>
              {{ step[0] }}
            </h2>

            <code>
              {{ step[1] }}
            </code>

            <p>
              {{ step[2] }}
            </p>
          </li>
        </ol>

        <DtNotice intent="warning">
          以下仅展示请求结构。节点 ID 和参数必须来自所选模板返回的
          configuration，不能把示例节点直接用于其他模板。保存配置会替换全部节点参数。
        </DtNotice>

        <pre
          >{{ example }}
</pre>

        <p>
          创建与训练请求带
          Idempotency-Key，同一逻辑请求使用同一个键。训练失败读取
          error_text，修正配置后使用新键重新训练。模板新版本不会自动升级已有模型，重新训练也不会替换已部署版本。
        </p>
      </div>
    </div>
  </AppShell>
</template>
<style scoped lang="scss">
.integration-body {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-bottom: 2rem;
}
.integration-steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
  gap: 1rem;
  list-style: none;
}
.integration-steps li {
  padding: 1.25rem;
  background: var(--surface-panel);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
h2 {
  font-size: var(--font-size-lg);
  font-weight: 600;
  margin-bottom: 0.6rem;
}
code {
  color: var(--accent-primary);
  overflow-wrap: anywhere;
}
p {
  color: var(--text-secondary);
  margin-top: 0.6rem;
}
pre {
  padding: 1.25rem;
  overflow: auto;
  background: var(--surface-panel);
  border-radius: var(--radius-lg);
}
</style>
