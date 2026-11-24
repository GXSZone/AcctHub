import type { Context } from 'hono';
import type { z } from 'zod';
import { Errors } from '../infra/errors';

/** 解析并校验 JSON 请求体，失败时抛出标准 VALIDATION_ERROR */
export async function parseJsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw Errors.validation('请求体必须为合法的 JSON 格式');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const msg = first?.message || '请求参数校验失败';
    throw Errors.validation(msg, parsed.error.issues);
  }
  return parsed.data;
}

/** 解析并校验 URL Query 参数 */
export function parseQueryParams<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  const raw = c.req.query();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw Errors.validation(first?.message || '查询参数不合法', parsed.error.issues);
  }
  return parsed.data;
}

/** 解析并校验路径参数（Route Params） */
export function parseRouteParams<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  const raw = c.req.param();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw Errors.validation(first?.message || '路径参数不合法', parsed.error.issues);
  }
  return parsed.data;
}
