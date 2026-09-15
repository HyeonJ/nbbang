import { execSync } from 'node:child_process';
import { requireTestDatabase } from './db-guard';

/**
 * 통합 테스트 스위트 전체에서 한 번 — 가드 확인 + 스키마 동기화.
 *
 * `push`가 아니라 `migrate`인 이유는 E2E와 같다: 이 프로젝트에서 스키마를 옮기는 경로는
 * 마이그레이션 파일뿐이고(`db:push`는 exit 1로 폐기됐다), 테스트가 push로 만든 스키마를
 * 상대하면 **마이그레이션이 깨진 채로도 초록**이 된다 — 검증할 대상을 비껴가는 것이다.
 */
export default async function setup() {
  await requireTestDatabase('통합 테스트');
  execSync('npx drizzle-kit migrate', { stdio: 'inherit', env: process.env });
}
