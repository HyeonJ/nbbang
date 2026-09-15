import { afterAll, beforeEach } from 'vitest';
import { pool } from '@/lib/db';
import { requireTestDatabase, truncateTestData } from './db-guard';

/**
 * 통합 테스트 파일마다 붙는 준비물.
 *
 * 가드는 `test/db-guard.ts` 한 구현을 E2E와 공유한다 — globalSetup이 이미 확인했지만
 * 여기서도 부른다(단일 파일만 골라 돌리는 경우에도 가드가 반드시 먼저 지나가게).
 * 스키마 동기화(migrate)는 globalSetup이 스위트 전체에 한 번만 한다.
 */
const sql = await requireTestDatabase('통합 테스트');

// 테스트 간 상태를 남기지 않는다 — 앞 테스트의 모임·원장이 남으면 잔액 단언이 조용히 어긋난다.
beforeEach(async () => {
  await truncateTestData(sql);
});

// lib/db의 Pool은 모듈 로드 시점에 열린다. 닫지 않으면 유휴 소켓 때문에 워커가 끝나지 않는다.
afterAll(async () => {
  await pool.end();
});
