import { execSync } from 'node:child_process';
import { requireTestDatabase, truncateTestData } from '../test/db-guard';

/**
 * E2E 전 테스트 DB 준비.
 * - 안전장치: test/db-guard.ts (센티널 → dev URL 대조). 통합 테스트도 **같은 구현**을 쓴다 —
 *   두 번째 사본을 두면 그 사본이 낡아 가드가 조용히 약해진다.
 * - 스키마 동기화: drizzle-kit migrate (drizzle.config.ts가 process.env.DATABASE_URL 사용)
 * - 데이터 초기화: 앱·인증 테이블 TRUNCATE
 *
 * DATABASE_URL은 playwright.config.ts가 .env.test에서 로드했거나(로컬),
 * CI 워크플로가 시크릿으로 주입한 값 — 두 경우 모두 테스트 브랜치여야 한다.
 */
export default async function globalSetup() {
  const sql = await requireTestDatabase('E2E');

  // drizzle/*.sql을 순서대로 적용한다 — 적용 이력은 DB의 drizzle.__drizzle_migrations가 갖고
  // 있으므로 이미 반영된 것은 건너뛴다. 이게 이 프로젝트에서 마이그레이션 경로가 실제로 도는
  // 자동 검증 지점이다 — 마이그레이션 누락·오류는 여기서 빨갛게 드러난다.
  // migrate도 public 스키마만 건드리므로(drizzle-kit의 schemaFilter 기본값) e2e_guard.sentinel은
  // 그대로 살아남는다.
  execSync('npx drizzle-kit migrate', { stdio: 'inherit', env: process.env });

  await truncateTestData(sql);
}
