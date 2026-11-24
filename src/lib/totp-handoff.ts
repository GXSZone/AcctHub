import { getAuthScope } from '../api/http';

type TotpHandoff = { secret: string; issuer?: string; account?: string };
let pending: { value: TotpHandoff; scope: string; expires: number } | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;

function clearHandoff() {
  pending = undefined;
  clearTimeout(expiry);
}

/** 只在当前标签页内存中交接凭证，不写入浏览器历史或持久化存储。 */
export function prepareTotpHandoff(value: TotpHandoff): string {
  clearHandoff();
  pending = { value, scope: getAuthScope(), expires: Date.now() + 10_000 };
  expiry = setTimeout(clearHandoff, 10_000);
  return '/2fa';
}

export function takeTotpHandoff(): TotpHandoff | undefined {
  const handoff = pending;
  clearHandoff();
  if (handoff?.scope === getAuthScope() && handoff.expires > Date.now()) return handoff.value;
}
