import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTestHarness, type TestHarness, unstable_readConfig } from 'wrangler';
import type { Env } from '../../worker/env';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runtimeConfig = unstable_readConfig({
  config: fileURLToPath(new URL('../../wrangler.toml', import.meta.url)),
});

export const D1_TEST_SETUP_SECRET = 'only-for-local-d1-setup-gate';

export async function startD1Harness() {
  const files = (await readdir(new URL('../../migrations/', import.meta.url)))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  if (!files.includes('0000_accthub_baseline.sql')) {
    throw new Error('D1 基线迁移 0000_accthub_baseline.sql 缺失');
  }

  const harness = createTestHarness({
    root,
    workers: [
      {
        config: {
          name: 'accthub-d1-gate',
          main: 'tests/runtime/runtime-worker.ts',
          compatibility_date: runtimeConfig.compatibility_date,
          compatibility_flags: runtimeConfig.compatibility_flags,
          d1_databases: [
            {
              binding: 'DB',
              database_name: 'accthub-d1-gate',
              database_id: randomUUID(),
              migrations_dir: 'migrations',
            },
          ],
          vars: {
            APP_ENV: 'test',
            SANDBOX_MODE: 'false',
            ADMIN_SECRET: D1_TEST_SETUP_SECRET,
            JWT_SECRET: 'only-for-local-d1-gate-tests-0000000',
            DATA_ENCRYPTION_KEYS: JSON.stringify({
              active: 'd1test',
              keys: { d1test: Buffer.from('accthub-d1-gate-enc-key-32bytes!').toString('base64') },
            }),
            DATA_FINGERPRINT_KEY: Buffer.from('accthub-d1-gate-fp-key-32-bytes!').toString('base64'),
          },
        },
      },
    ],
  });

  try {
    await harness.listen();
    return await applyMigrations(harness, files);
  } catch (error) {
    await harness.close();
    throw error;
  }
}

async function applyMigrations(harness: TestHarness, expectedFiles: string[]) {
  const worker = harness.getWorker<Env>();
  await worker.applyD1Migrations('DB');
  const { DB } = await worker.getEnv();
  const applied = await DB.prepare('SELECT name FROM d1_migrations ORDER BY name').all<{ name: string }>();
  if (JSON.stringify(applied.results.map((row) => row.name)) !== JSON.stringify(expectedFiles)) {
    throw new Error(`D1 未原样应用仓库迁移 ${expectedFiles.join(', ')}`);
  }

  return { harness, worker, d1: DB };
}

export type D1Harness = Awaited<ReturnType<typeof startD1Harness>>;
