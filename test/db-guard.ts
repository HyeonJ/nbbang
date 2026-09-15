import fs from 'node:fs';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import dotenv from 'dotenv';
import * as schema from '../lib/db/schema';

/**
 * "이 DB를 파괴적으로 다뤄도 되는가"의 **유일한 구현**.
 *
 * Playwright의 `e2e/global-setup.ts`와 Vitest 통합 테스트(`test/db-global-setup.ts`,
 * `test/db-fixture.ts`)가 모두 이 파일을 부른다. 손으로 베낀 두 번째 사본을 두면
 * 바로 그 사본이 낡아서 가드가 조용히 약해진다 — 그래서 한 곳에만 둔다.
 * 검사 **순서와 의미는 바꾸지 않는다**(URL 존재 → 센티널 → dev DB 대조).
 */

/**
 * DB 식별 키. 같은 DB를 가리키는 다른 표기(pooled `-pooler` 호스트 vs 직접 연결,
 * 쿼리 파라미터 차이)를 같은 키로 정규화한다 — 문자열 완전 일치 비교는 이를 놓친다.
 */
const dbKey = (u: string) => {
  const p = new URL(u);
  return `${p.hostname.replace('-pooler', '')}${p.pathname}`;
};

/**
 * 테스트가 비우는 테이블 — `lib/db/schema.ts`에서 **파생**한다.
 *
 * 손으로 적은 목록을 두 곳(E2E·통합)에 두는 것이 Plan 03 규칙 5가 경고한 바로 그 함정이다.
 * 스키마에서 뽑으면 테이블을 추가하는 순간 목록이 따라오므로 "갱신을 잊는" 경로가 사라진다.
 * `user`처럼 예약어인 이름이 있으므로 전부 따옴표로 묶는다. CASCADE라 순서는 무관하다.
 */
export const TEST_TABLES: readonly string[] = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .map((t) => getTableName(t))
  .sort();

/**
 * 테스트 DB를 확인하고 쿼리 함수를 돌려준다. 하나라도 어긋나면 **아무 쓰기도 하지 않고** 던진다.
 *
 * `label`은 실패 메시지에 들어간다 — E2E와 통합 테스트 중 어느 경로가 막혔는지 구별된다.
 */
export async function requireTestDatabase(label: string): Promise<NeonQueryFunction<false, false>> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      `DATABASE_URL이 없습니다(${label}). 로컬은 .env.test, CI는 TEST_DATABASE_URL 시크릿을 확인하세요.`,
    );
  }

  const sql = neon(url);

  // 1차(주) 안전장치: 센티널 테이블. 마이그레이션이 절대 만들지 않는 마커라서
  // URL을 어떤 표기로 적었든 "이 DB가 테스트 전용 브랜치인가"를 DB 자체에 물어본다.
  // 센티널은 별도 스키마(e2e_guard)에 산다 — drizzle-kit은 public만 관리하므로 이 마커를 볼 수도, 지울 수도 없다.
  const [{ ok }] = await sql`select to_regclass('e2e_guard.sentinel') is not null as ok`;
  if (!ok) {
    throw new Error(
      `e2e_guard.sentinel 테이블이 없습니다 — 이 DB는 테스트 전용 브랜치가 아닙니다(${label}). 테스트 브랜치에서 create schema if not exists e2e_guard; create table if not exists e2e_guard.sentinel(); 를 한 번 실행하세요.`,
    );
  }

  // 2차 안전장치: dev DB(.env.local)를 절대 TRUNCATE하지 않는다.
  // CI에는 .env.local이 없다(테스트 DB 시크릿만 보관) — 그래서 파일이 없으면 이 검사는 건너뛴다.
  if (fs.existsSync('.env.local')) {
    const dev = dotenv.parse(fs.readFileSync('.env.local', 'utf8'));
    if (dev.DATABASE_URL && dbKey(dev.DATABASE_URL) === dbKey(url)) {
      throw new Error(
        `DATABASE_URL이 .env.local(dev DB)과 같은 DB를 가리킵니다(${label}). 테스트는 테스트 브랜치에서만 실행하세요.`,
      );
    }
  }

  return sql;
}

/** 앱·인증 테이블을 모두 비운다. 호출자는 requireTestDatabase가 돌려준 sql만 넘겨야 한다. */
export async function truncateTestData(sql: NeonQueryFunction<false, false>): Promise<void> {
  const list = TEST_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.query(`TRUNCATE TABLE ${list} CASCADE`);
}
