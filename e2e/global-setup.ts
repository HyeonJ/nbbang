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

/**
 * DB 식별 키. 같은 DB를 가리키는 다른 표기(pooled `-pooler` 호스트 vs 직접 연결,
 * 쿼리 파라미터 차이)를 같은 키로 정규화한다 — 문자열 완전 일치 비교는 이를 놓친다.
 */
const dbKey = (u: string) => {
  const p = new URL(u);
  return `${p.hostname.replace('-pooler', '')}${p.pathname}`;
};

export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL이 없습니다. 로컬은 .env.test, CI는 TEST_DATABASE_URL 시크릿을 확인하세요.');
  }

  const sql = neon(url);

  // 1차(주) 안전장치: 센티널 테이블. drizzle-kit push가 절대 만들지 않는 마커라서
  // URL을 어떤 표기로 적었든 "이 DB가 E2E 전용 브랜치인가"를 DB 자체에 물어본다.
  const [{ ok }] = await sql`select to_regclass('public.e2e_sentinel') is not null as ok`;
  if (!ok) {
    throw new Error(
      'e2e_sentinel 테이블이 없습니다 — 이 DB는 E2E 전용 브랜치가 아닙니다. 테스트 브랜치에서 create table e2e_sentinel(); 를 한 번 실행하세요.',
    );
  }

  // 2차 안전장치: dev DB(.env.local)를 절대 TRUNCATE하지 않는다.
  // CI에는 .env.local이 없다(테스트 DB 시크릿만 보관) — 그래서 파일이 없으면 이 검사는 건너뛴다.
  if (fs.existsSync('.env.local')) {
    const dev = dotenv.parse(fs.readFileSync('.env.local', 'utf8'));
    if (dev.DATABASE_URL && dbKey(dev.DATABASE_URL) === dbKey(url)) {
      throw new Error('DATABASE_URL이 .env.local(dev DB)과 같은 DB를 가리킵니다. E2E는 테스트 브랜치에서만 실행하세요.');
    }
  }

  execSync('npx drizzle-kit push --force', { stdio: 'inherit', env: process.env });

  // push --force는 스키마에 없는 e2e_sentinel을 지운다 — 검사를 통과한 DB이므로 다시 세워 다음 실행을 보장한다.
  // (검사는 push보다 앞서 끝났으므로 이 재생성이 가드를 약화시키지 않는다.)
  await sql`create table if not exists e2e_sentinel()`;

  await sql`TRUNCATE TABLE memberships, groups, session, account, verification, "user" CASCADE`;
}
