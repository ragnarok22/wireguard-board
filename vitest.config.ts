import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      setupFiles: ['./src/test/test-setup.ts'],
      clearMocks: true,
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        include: [
          'src/lib/api-client.ts',
          'src/lib/api-types.ts',
          'src/lib/client-config.ts',
          'src/lib/server-storage.ts',
          'src/lib/server-transfer.ts',
          'src/lib/formatters.ts',
          'src/features/**/*.tsx',
          'src/hooks/*.ts',
          'src/app.tsx',
          'src/components/ui/*.tsx',
          'server/**/*.ts',
          'api/**/*.ts',
          'scripts/smoke-deployment.ts',
        ],
        reporter: ['text', 'html', 'lcov'],
        thresholds: { statements: 85, lines: 85, branches: 80, functions: 80 },
      },
    },
  }),
)
