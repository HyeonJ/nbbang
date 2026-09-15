import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const alias = { '@': path.resolve(import.meta.dirname, '.') };

/**
 * 두 프로젝트로 나눈다 — `unit`은 **DB 없이** 돌아야 하고(그래서 CI의 check 잡이 DB 시크릿을
 * 갖지 않는다), `integration`은 테스트 브랜치 DB를 실제로 왕복한다.
 * `npm test` = unit만, `npm run test:integration` = .env.test로 integration만.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        test: {
          name: 'unit',
          include: ['lib/**/*.test.ts', 'actions/**/*.test.ts'],
          // 통합 테스트가 이 include에 섞여 들어오면 DB 없는 잡에서 터진다.
          exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
        resolve: { alias },
      },
      {
        plugins: [react()],
        test: {
          name: 'integration',
          include: ['test/**/*.integration.test.ts'],
          environment: 'node',
          // 같은 DB를 공유하고 beforeEach마다 TRUNCATE한다 — 병렬로 돌면 서로의 데이터를 지운다.
          fileParallelism: false,
          globalSetup: ['test/db-global-setup.ts'],
          setupFiles: ['test/db-fixture.ts'],
          // Neon 왕복이 섞여 있어 기본 5초는 빡빡하다.
          testTimeout: 30_000,
        },
        resolve: { alias },
      },
    ],
  },
});
