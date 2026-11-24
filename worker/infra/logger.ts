const REDACT_KEYS = /(secret|password|token|api_?key|authorization|card_content|delivered_payload)/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? '[REDACTED]' : sanitizeValue(v, depth + 1);
  }
  return out;
}

type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, event: string, meta?: Record<string, unknown>): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(meta ? (sanitizeValue(meta) as Record<string, unknown>) : {}),
  };
  const serialized = JSON.stringify(payload);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.info(serialized);
}

export const logger = {
  info: (event: string, meta?: Record<string, unknown>) => emit('info', event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => emit('warn', event, meta),
  error: (event: string, meta?: Record<string, unknown>) => emit('error', event, meta),
};
