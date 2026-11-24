import { Errors } from './errors';
import { assertSafeOutboundUrl } from './http';

export function assertSafeMailEndpoint(endpoint: string): string {
  const url = assertSafeOutboundUrl(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw Errors.validation('自定义发信网关必须使用 HTTPS，地址不得包含用户凭据或片段');
  }
  return url.href;
}
