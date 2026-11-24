/**
 * 开放平台与 B2B 批采 API 文档代码片段生成器与方法样式映射（纯 Host 多租户，零 ?tenant= 拼接）
 */

import type { CodeLang, EndpointSpec } from './api-docs.catalog';

export function methodStyle(method: EndpointSpec['method']) {
  switch (method) {
    case 'GET':
      return { bg: 'var(--success-soft)', color: 'var(--success)' };
    case 'POST':
      return { bg: 'var(--accent-soft)', color: 'var(--accent)' };
    case 'PUT':
      return { bg: 'var(--warning-soft)', color: 'var(--warning)' };
    default:
      return { bg: 'var(--danger-soft)', color: 'var(--danger)' };
  }
}

export function buildSnippet(ep: EndpointSpec, lang: CodeLang, origin: string): string {
  const url = `${origin}${ep.livePath || ep.path}`;
  const authHeader =
    ep.auth === 'reseller_key'
      ? 'Authorization: Bearer <YOUR_AGENT_API_KEY>'
      : ep.auth === 'user_jwt'
        ? 'Authorization: Bearer <YOUR_USER_JWT>'
        : ep.auth === 'admin_jwt'
          ? 'Authorization: Bearer <YOUR_SUPER_ADMIN_JWT>'
          : '';
  const bodyJson = ep.sampleRequestBody ? JSON.stringify(ep.sampleRequestBody, null, 2) : '';

  if (lang === 'curl') {
    const lines = [`curl -X ${ep.method} "${url}"`];
    if (authHeader) lines.push(`  -H "${authHeader}"`);
    if (bodyJson) {
      lines.push(`  -H "Content-Type: application/json"`);
      lines.push(`  -d '${JSON.stringify(ep.sampleRequestBody)}'`);
    }
    return lines.join(' \\\n');
  }

  if (lang === 'ts') {
    const headers: Record<string, string> = {};
    if (ep.auth === 'reseller_key') headers.Authorization = 'Bearer <YOUR_AGENT_API_KEY>';
    if (ep.auth === 'user_jwt') headers.Authorization = 'Bearer <YOUR_USER_JWT>';
    if (ep.auth === 'admin_jwt') headers.Authorization = 'Bearer <YOUR_SUPER_ADMIN_JWT>';
    if (bodyJson) headers['Content-Type'] = 'application/json';

    const fetchFn = 'fetch';
    return `const res = await ${fetchFn}("${url}", {
  method: "${ep.method}",${
    Object.keys(headers).length
      ? `\n  headers: ${JSON.stringify(headers, null, 2).replace(/\n/g, '\n  ')},`
      : ''
  }${bodyJson ? `\n  body: JSON.stringify(${bodyJson.replace(/\n/g, '\n  ')}),` : ''}
});
const data = await res.json();
console.log(data);`;
  }

  return `req, _ := http.NewRequest("${ep.method}", "${url}", ${
    bodyJson ? `strings.NewReader(\`${JSON.stringify(ep.sampleRequestBody)}\`)` : 'nil'
  })${authHeader ? `\nreq.Header.Set("${authHeader.split(':')[0]}", "${authHeader.split(': ')[1]}")` : ''}${
    bodyJson ? '\nreq.Header.Set("Content-Type", "application/json")' : ''
  }
resp, err := http.DefaultClient.Do(req)`;
}
