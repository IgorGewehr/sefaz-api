import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['{apps,libs}/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'legacy'],
  },
  resolve: {
    alias: {
      '@app/common': resolve(__dirname, 'libs/common/src'),
      '@app/database': resolve(__dirname, 'libs/database/src'),
      '@app/fiscal-core': resolve(__dirname, 'libs/fiscal-core/src'),
      '@app/sefaz': resolve(__dirname, 'libs/sefaz/src'),
      '@app/kms': resolve(__dirname, 'libs/kms/src'),
      '@app/crypto': resolve(__dirname, 'libs/crypto/src'),
      '@app/storage': resolve(__dirname, 'libs/storage/src'),
    },
  },
});
