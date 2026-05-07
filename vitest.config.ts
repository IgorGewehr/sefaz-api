import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'tsconfig-paths/register';

void tsconfigPaths;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['{apps,libs}/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'legacy'],
  },
  resolve: {
    alias: {
      '@app/common': new URL('./libs/common/src', import.meta.url).pathname,
      '@app/database': new URL('./libs/database/src', import.meta.url).pathname,
      '@app/fiscal-core': new URL('./libs/fiscal-core/src', import.meta.url).pathname,
      '@app/sefaz': new URL('./libs/sefaz/src', import.meta.url).pathname,
      '@app/kms': new URL('./libs/kms/src', import.meta.url).pathname,
      '@app/crypto': new URL('./libs/crypto/src', import.meta.url).pathname,
      '@app/storage': new URL('./libs/storage/src', import.meta.url).pathname,
    },
  },
});
