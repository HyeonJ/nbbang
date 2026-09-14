import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import fs from 'node:fs';

// 로컬: .env.test(테스트 브랜치 DB)를 로드. CI: 파일이 없으므로 스킵하고
// 워크플로가 주입한 process.env(DATABASE_URL 등)를 그대로 쓴다.
// dotenv는 이미 설정된 process.env를 덮어쓰지 않는다.
if (fs.existsSync('.env.test')) {
  dotenv.config({ path: '.env.test' });
}

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000',
    timeout: 240_000,
    // 잔여 dev 서버(.env.local DB)를 재사용하면 테스트가 dev DB를 오염시킨다 — 항상 새로 띄운다.
    reuseExistingServer: false,
    env: {
      ...(process.env as Record<string, string>),
      DATABASE_URL: process.env.DATABASE_URL!,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    },
  },
});
