import fs from 'node:fs';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
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
 *
 * 값은 **완성된 식별자**다(`"public"."groups"`) — 두 가지를 함께 담는다:
 *  1. `user`처럼 예약어인 이름이 있으므로 전부 따옴표로 묶는다.
 *  2. **스키마까지 적는다.** `getTableName`만 쓰면 목록이 "이 테이블은 public에 있다"를
 *     암묵적으로 가정하고, TRUNCATE는 `search_path`가 가리키는 곳을 비운다. 지금은 전부
 *     public이라 결과가 같지만, 누군가 `pgSchema('archive')` 테이블을 스키마에 추가하는
 *     순간 목록은 조용히 **엉뚱한 테이블**(또는 존재하지 않는 이름)을 가리킨다. 테이블마다
 *     자기 스키마를 들고 오게 해서 그 경로를 닫는다 — 센티널이 사는 `e2e_guard`처럼
 *     public 밖의 스키마가 이미 이 레포에 있으므로 가정이 아니라 실재하는 위험이다.
 *
 * CASCADE라 순서는 무관하다.
 */
export const TEST_TABLES: readonly string[] = (Object.values(schema) as unknown[])
  .filter((v): v is PgTable => is(v, PgTable))
  .map((t) => {
    const { name, schema: tableSchema } = getTableConfig(t);
    // pgTable(...)로 만든 테이블은 schema가 undefined다 — 그때의 실제 위치가 public이다.
    return `"${tableSchema ?? 'public'}"."${name}"`;
  })
  .sort();

/**
 * 가드를 통과한 쿼리 핸들.
 *
 * 런타임 값은 `neon(url)`이 돌려준 함수 **그대로**이고, 표시는 타입에만 있다(브랜드). 이 타입을
 * 만드는 캐스트는 아래 `requireTestDatabase`의 마지막 줄 **한 곳뿐**이므로, `GuardedSql`을
 * 손에 들고 있다는 사실이 곧 "센티널·dev DB 대조를 통과한 DB다"의 증거가 된다.
 *
 * 왜 필요한가: `truncateTestData`가 아무 핸들이나 받으면 "이 DB를 파괴해도 되는가"라는 판정을
 * **호출자가 기억해야** 한다. 미래의 호출자가 `neon(process.env.DATABASE_URL!)`을 그냥 넘기면
 * (이 레포의 스펙들이 읽기용으로 실제로 그렇게 만든다 — `authz.spec.ts`, `helpers.ts`)
 * 가드는 통째로 우회되고 타입 검사는 조용히 통과한다. 브랜드는 그 우회를 **컴파일 에러**로 만든다.
 */
declare const guardedBrand: unique symbol;
export type GuardedSql = NeonQueryFunction<false, false> & { readonly [guardedBrand]: true };

/**
 * 테스트 DB를 확인하고 쿼리 함수를 돌려준다. 하나라도 어긋나면 **아무 쓰기도 하지 않고** 던진다.
 *
 * `label`은 실패 메시지에 들어간다 — E2E와 통합 테스트 중 어느 경로가 막혔는지 구별된다.
 */
export async function requireTestDatabase(label: string): Promise<GuardedSql> {
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

  // 세 검사를 모두 통과한 이 지점이 브랜드를 붙이는 **유일한** 자리다.
  return sql as GuardedSql;
}

/**
 * 앱·인증 테이블을 모두 비운다.
 *
 * 인자가 `GuardedSql`이므로 `requireTestDatabase`를 지나온 핸들만 들어온다 — "이 DB를 비워도
 * 되는가"를 호출자가 기억하는 규약이 아니라 **타입이 강제하는 전제**다.
 */
export async function truncateTestData(sql: GuardedSql): Promise<void> {
  // TEST_TABLES는 이미 따옴표로 묶인 스키마 수식 식별자다 — 여기서 다시 감싸지 않는다.
  await sql.query(`TRUNCATE TABLE ${TEST_TABLES.join(', ')} CASCADE`);
}
