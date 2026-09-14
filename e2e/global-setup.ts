import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

/**
 * E2E 전 테스트 DB 준비.
 * - 스키마 동기화: drizzle-kit push (drizzle.config.ts가 process.env.DATABASE_URL 사용)
 * - 데이터 초기화: 앱·인증 테이블 TRUNCATE
 *
 * DATABASE_URL은 playwright.config.ts가 .env.test에서 로드했거나(로컬),
 * CI 워크플로가 시크릿으로 주입한 값 — 두 경우 모두 테스트 브랜치여야 한다.
 */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL이 없습니다. 로컬은 .env.test, CI는 TEST_DATABASE_URL 시크릿을 확인하세요.');
  }

  // 안전장치: dev DB(.env.local)를 절대 TRUNCATE하지 않는다.
  if (fs.existsSync('.env.local')) {
    const dev = dotenv.parse(fs.readFileSync('.env.local', 'utf8'));
    if (dev.DATABASE_URL && dev.DATABASE_URL === url) {
      throw new Error('DATABASE_URL이 .env.local(dev DB)과 동일합니다. E2E는 테스트 브랜치에서만 실행하세요.');
    }
  }

  execSync('npx drizzle-kit push --force', { stdio: 'inherit', env: process.env });

  const sql = neon(url);
  await sql`TRUNCATE TABLE memberships, groups, session, account, verification, "user" CASCADE`;
}
