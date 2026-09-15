import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

/**
 * E2E 전 테스트 DB 준비.
 * - 스키마 동기화: drizzle-kit migrate (drizzle.config.ts가 process.env.DATABASE_URL 사용)
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

  // 1차(주) 안전장치: 센티널 테이블. 마이그레이션이 절대 만들지 않는 마커라서
  // URL을 어떤 표기로 적었든 "이 DB가 E2E 전용 브랜치인가"를 DB 자체에 물어본다.
  // 센티널은 별도 스키마(e2e_guard)에 산다 — drizzle-kit은 public만 관리하므로 이 마커를 볼 수도, 지울 수도 없다.
  const [{ ok }] = await sql`select to_regclass('e2e_guard.sentinel') is not null as ok`;
  if (!ok) {
    throw new Error(
      'e2e_guard.sentinel 테이블이 없습니다 — 이 DB는 E2E 전용 브랜치가 아닙니다. 테스트 브랜치에서 create schema if not exists e2e_guard; create table if not exists e2e_guard.sentinel(); 를 한 번 실행하세요.',
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

  // drizzle/*.sql을 순서대로 적용한다 — 적용 이력은 DB의 drizzle.__drizzle_migrations가 갖고
  // 있으므로 이미 반영된 것은 건너뛴다. 이게 이 프로젝트에서 마이그레이션 경로가 실제로 도는
  // 유일한 자동 검증 지점이다 — 마이그레이션 누락·오류는 여기서 빨갛게 드러난다.
  // migrate도 public 스키마만 건드리므로(drizzle-kit의 schemaFilter 기본값) e2e_guard.sentinel은
  // 그대로 살아남는다.
  execSync('npx drizzle-kit migrate', { stdio: 'inherit', env: process.env });

  // CASCADE가 FK로 딸린 테이블까지 알아서 비우지만, 지워지는 테이블은 이름으로 남겨둔다 —
  // 목록을 읽으면 "E2E가 무엇을 초기화하는지"가 드러나야 한다.
  await sql`TRUNCATE TABLE dues_payments, dues_rounds, ledger_entries, memberships, groups, session, account, verification, "user" CASCADE`;
}
