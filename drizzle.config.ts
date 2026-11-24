import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './worker/db/schema/index.ts',
  out: './migrations',
  dialect: 'sqlite',
});
