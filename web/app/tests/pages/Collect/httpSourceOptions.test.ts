/** @fileoverview HTTP 请求参数边界、认证必填与凭据序列化契约。 */
import { describe, expect, it } from 'vitest'
import {
  defaultHttpOptions,
  validateHttpAuth,
  validateHttpEndpoint,
  validateHttpOptions,
} from '@/pages/Collect/Opcua/scripts/httpSourceOptions'
import {
  toCreateInput,
  toUpdateInput,
  validateSourceForm,
  type SourceFormValues,
} from '@/pages/Collect/Opcua/scripts/sourceFormPayload'

function values(extraOptions: Record<string, string> = {}): SourceFormValues {
  return {
    protocol: 'http',
    name: '接口',
    code: 'http_api',
    description: '',
    endpoint: 'https://api.example.com/metrics',
    securityMode: 'None',
    securityPolicy: 'None',
    readMode: 'poll',
    pollIntervalMs: 1000,
    username: '',
    credential: '',
    isCredentialCleared: false,
    isEnabled: true,
    extraOptions: { ...defaultHttpOptions(), ...extraOptions },
  }
}

describe('HTTP 请求参数', () => {
  it('GET 与任意 JSON POST 请求体均可保存，默认配置合法', () => {
    expect(validateHttpOptions(defaultHttpOptions())).toBeNull()
    expect(
      validateHttpOptions({
        method: 'POST',
        body_json: '[1,true,{"value":"ok"}]',
        query_json: '{"plant":"一号厂"}',
      }),
    ).toBeNull()
    expect(
      validateHttpOptions({ method: 'POST', body_json: 'null' }),
    ).toBeNull()
  })
  it.each([
    [{ method: 'PUT' }, 'GET 或 POST'],
    [{ auth_type: 'cookie' }, '认证方式'],
    [{ timeout_s: 'NaN' }, '超时'],
    [{ timeout_s: '0' }, '超时'],
    [{ timeout_s: '11' }, '超时'],
    [{ max_response_bytes: '0' }, '响应上限'],
    [{ max_response_bytes: '4194305' }, '响应上限'],
    [{ max_response_bytes: '1.5' }, '响应上限'],
    [{ headers_json: '[' }, '有效 JSON'],
    [{ headers_json: '[]' }, '字符串映射'],
    [{ headers_json: '{"foo":1}' }, '字符串'],
    [{ headers_json: '{"": "foo"}' }, '名称'],
    [{ headers_json: '{"Authorization":"secret"}' }, '认证配置'],
    [{ query_json: '{"token":"secret"}' }, '认证配置'],
    [{ headers_json: '{"Host":"example.com"}' }, '路由'],
    [{ headers_json: '{"Bad Header":"ok"}' }, '格式'],
    [{ headers_json: '{"Accept":"a","accept":"b"}' }, '重复'],
    [
      { method: 'POST', body_json: '{"nested":{"client_secret":"hidden"}}' },
      '认证秘密',
    ],
    [{ method: 'POST', body_json: '{' }, '有效 JSON'],
    [{ body_json: '{}' }, 'POST'],
  ])('拒绝非法配置 %j', (options, message) => {
    expect(validateHttpOptions(options)).toContain(message)
  })
  it('配置大小、数量与深度有明确上限', () => {
    expect(
      validateHttpOptions({
        headers_json: JSON.stringify({ huge: 'x'.repeat(65_536) }),
      }),
    ).toContain('64 KiB')
    expect(
      validateHttpOptions({
        query_json: JSON.stringify(
          Object.fromEntries(
            Array.from({ length: 65 }, (_, index) => [`field${index}`, '1']),
          ),
        ),
      }),
    ).toContain('64')
    expect(
      validateHttpOptions({
        method: 'POST',
        body_json: '"' + 'x'.repeat(65_536) + '"',
      }),
    ).toContain('64 KiB')
    expect(
      validateHttpOptions({
        method: 'POST',
        body_json: '['.repeat(66) + '0' + ']'.repeat(66),
      }),
    ).toContain('64 层')
  })
  it.each([
    'accessToken',
    'clientSecret',
    'pass word',
    'X-Auth-Token',
    'serviceApiKey',
  ])('密钥名称 %s 在表单边界明确拒绝', (key) => {
    expect(
      validateHttpOptions({ query_json: JSON.stringify({ [key]: 'secret' }) }),
    ).toContain('认证配置')
    expect(
      validateHttpOptions({
        method: 'POST',
        body_json: JSON.stringify({ nested: { [key]: 'secret' } }),
      }),
    ).toContain('认证秘密')
    expect(
      validateHttpEndpoint(
        new URL(`https://api.example.com?${encodeURIComponent(key)}=secret`),
      ),
    ).toContain('认证秘密')
  })
  it('拒绝非有限请求体与 API Key 头碰撞', () => {
    expect(
      validateHttpOptions({ method: 'POST', body_json: '{"value":1e999}' }),
    ).toContain('有限数值')
    expect(
      validateHttpOptions({
        auth_type: 'api_key',
        auth_header: 'X-Plant-Key',
        headers_json: '{"x-plant-key":"secret"}',
      }),
    ).toContain('普通请求头重复')
  })
  it.each([
    'https://api.example.com?token=x',
    'http://user:secret@example.com',
    'ftp://example.com',
    'https://example.com#section',
    'http://example.com:0',
  ])('拒绝敏感或无效端点 %s', (url) => {
    expect(validateHttpEndpoint(new URL(url))).not.toBeNull()
  })
})

describe('认证与数据源请求体', () => {
  it('HTTP 周期下限独立于通用 50ms 下限', () => {
    expect(
      validateSourceForm({ ...values(), pollIntervalMs: 500 }, false),
    ).toContain('1000')
    expect(
      validateSourceForm({ ...values(), endpoint: 'not-url' }, false),
    ).toContain('格式')
  })
  it('Basic 与 OAuth 账户必填；API Key 头名称和 Token URL 明确校验', () => {
    expect(validateHttpAuth({ auth_type: 'basic' }, '', true)).toContain(
      '用户名',
    )
    expect(
      validateHttpAuth({ auth_type: 'oauth2_client_credentials' }, '', true),
    ).toContain('Client ID')
    expect(
      validateHttpAuth(
        { auth_type: 'api_key', auth_header: 'Bad Header' },
        '',
        true,
      ),
    ).toContain('名称')
    expect(
      validateHttpAuth(
        { auth_type: 'api_key', auth_header: 'Cookie' },
        '',
        true,
      ),
    ).toContain('不可使用')
    expect(
      validateHttpAuth(
        { auth_type: 'oauth2_client_credentials' },
        'client',
        true,
      ),
    ).toContain('Token URL')
    expect(
      validateHttpAuth(
        {
          auth_type: 'oauth2_client_credentials',
          token_endpoint: 'http://user:secret@example.com',
        },
        'client',
        true,
      ),
    ).not.toBeNull()
  })
  it('切换匿名清除秘密；Bearer 不携带旧用户名；编辑已存凭据可留空', () => {
    expect(
      toCreateInput({ ...values(), username: 'old', credential: 'old' }),
    ).toMatchObject({ username: undefined, credential: undefined })
    expect(
      toUpdateInput({ ...values(), username: 'old', credential: 'old' }),
    ).toMatchObject({ username: null, credential: null })
    expect(
      toCreateInput({
        ...values({ auth_type: 'bearer' }),
        username: 'old',
        credential: 'token',
      }),
    ).toMatchObject({ username: undefined, credential: 'token' })
    expect(
      validateSourceForm(
        { ...values({ auth_type: 'bearer' }), hasCredential: true },
        true,
      ),
    ).toBeNull()
    expect(validateSourceForm(values({ auth_type: 'bearer' }), true)).toContain(
      '凭据',
    )
    expect(
      validateSourceForm(
        {
          ...values({ auth_type: 'bearer' }),
          hasCredential: true,
          isCredentialCleared: true,
        },
        true,
      ),
    ).toContain('凭据')
  })
})
