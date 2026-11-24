import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** 生成 Worker 优先路由，并从发布配置移除本地绑定。 */
function prepareWorkerBuildConfig(sandbox: boolean): Plugin {
  return {
    name: 'accthub-prod-edge-seo',
    apply: 'build',
    closeBundle() {
      const targetPath = join(process.cwd(), 'dist', 'accthub', 'wrangler.json');
      if (!existsSync(targetPath)) return;
      const raw = JSON.parse(readFileSync(targetPath, 'utf8')) as {
        assets?: { run_worker_first?: string[] | boolean; binding?: string };
        vars?: Record<string, string>;
      };
      if (raw.assets) {
        raw.assets.binding = 'ASSETS';
        raw.assets.run_worker_first = ['/api/*', '/', '/item/*', '/orders', '/help', '/agent'];
      }
      if (!sandbox) raw.vars = { APP_ENV: 'production', SANDBOX_MODE: 'false' };
      writeFileSync(targetPath, JSON.stringify(raw));
    },
  };
}

function resolveClientVendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (
    id.includes('/react/') ||
    id.includes('\\react\\') ||
    id.includes('/react-dom/') ||
    id.includes('\\react-dom\\') ||
    id.includes('/react-router') ||
    id.includes('\\react-router') ||
    id.includes('/scheduler/') ||
    id.includes('\\scheduler\\')
  ) {
    return 'vendor-react';
  }
  if (id.includes('/@tanstack/') || id.includes('\\@tanstack\\')) {
    return 'vendor-query';
  }
  if (id.includes('/lucide-react/') || id.includes('\\lucide-react\\')) {
    return 'vendor-icons';
  }
  if (id.includes('/zod/') || id.includes('\\zod\\')) {
    return 'vendor-zod';
  }
  return undefined;
}

export default defineConfig(({ command, mode, isPreview }) => ({
  define: { __ACCTHUB_SANDBOX__: (command === 'serve' && !isPreview) || mode === 'sandbox' },
  // 源码映射会保留已裁掉的沙盒源码，不能进入发布包。
  build: { sourcemap: false },
  plugins: [react(), tailwindcss(), cloudflare(), prepareWorkerBuildConfig(mode === 'sandbox')],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@web': fileURLToPath(new URL('./src', import.meta.url)),
      '@worker': fileURLToPath(new URL('./worker', import.meta.url)),
    },
  },
  environments: {
    client: {
      build: {
        rollupOptions: {
          output: {
            manualChunks: resolveClientVendorChunk,
          },
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
}));
