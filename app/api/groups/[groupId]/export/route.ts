import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { attachmentDisposition, safeFilenamePart, toCsvFile, type CsvColumn } from '@/lib/csv';
import { getAllEntries, getGroupForMember, type LedgerExportRow } from '@/lib/db/queries';
import { formatDateKst } from '@/lib/format';

/**
 * 원장 CSV 내보내기 (F7) — **인증이 필요한** 다운로드.
 *
 * ── 왜 라우트 핸들러이고, 왜 인가를 직접 쓰는가 ─────────────────────────────
 * 파일 다운로드는 서버 액션으로 할 수 없다(액션 응답은 플라이트 페이로드이지 파일이 아니다).
 * 그래서 이 경로는 **`groupActionClient`를 지나지 않는다** — `actions/`의 모든 쓰기가 공유하는
 * 인가 미들웨어(세션 → 멤버십 → 역할)가 여기엔 없다. 즉 **이 파일의 아래 네 줄이 이 경로의
 * 인가 전부**다. 지우거나 순서를 바꾸면 남의 모임 장부가 URL 하나로 나간다.
 * `e2e/authz.spec.ts`의 마지막 테스트가 다섯 역할(총무·멤버·비멤버·미인증·공개링크 방문자)로
 * 이 네 줄을 매 푸시마다 다시 확인한다.
 *
 * ── 공개 장부(`/g/:token`)와 다른 점 ────────────────────────────────────────
 * 공개 장부는 링크만 있으면 열리지만 **화면**이고 한 모임의 요약이다. CSV는 원본 데이터의
 * 일괄 반출이라 파일이 되어 카톡방·메일로 재유통된다. 그래서 인증을 요구한다.
 * 반대로 **내용은 공개 장부보다 더 보수적이다** — 공개 장부가 내보내지 않는 것은 여기서도
 * 내보내지 않는다(토큰·이메일·userId·groupId·멤버십 id). `getAllEntries`가 컬럼을 하나하나
 * 골라 그것을 구조적으로 보장한다.
 *
 * Task 10이 추가할 계좌 문구(`groups.accountLabel`)도 **CSV에 넣지 않는다** — 이것은
 * 원장 내보내기이지 모임 설정 내보내기가 아니다(플랜 T10 Step 4의 3줄 규칙).
 */

/** 열 정의가 곧 노출 명세다 — 여기 없는 값은 파일로 나가지 않는다. */
const COLUMNS: readonly CsvColumn[] = [
  { key: 'date', header: '일자', type: 'text' },
  { key: 'kind', header: '종류', type: 'text' },
  // 금액만 number다 — 나머지는 text이므로 수식 주입 방어 접두사가 붙는다.
  // 음수 지출이 `-96000`(ASCII 하이픈)으로 나가야 스프레드시트가 숫자로 읽는다.
  { key: 'amount', header: '금액', type: 'number' },
  { key: 'category', header: '분류', type: 'text' },
  { key: 'memo', header: '메모', type: 'text' },
  { key: 'reversalTarget', header: '정정대상', type: 'text' },
];

const KIND_LABEL = {
  DUES_PAYMENT: '회비 납부',
  EXPENSE: '지출',
  REVERSAL: '정정',
} as const;

/** 정정 대상을 사람이 알아볼 수 있는 한 문구로. 정정이 아닌 행은 빈 셀. */
function reversalTargetOf(e: LedgerExportRow): string {
  if (!e.reversalTargetOccurredAt) return '';
  const label = e.reversalTargetMemo ?? e.reversalTargetCategory ?? '';
  const date = formatDateKst(e.reversalTargetOccurredAt);
  return label ? `${date} ${label}` : date;
}

export async function GET(_req: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new NextResponse('unauthorized', { status: 401 });
  // 멤버만. 비멤버에게는 401이 아니라 **404**다 — 401은 "그 모임은 있다"를 알려준다.
  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) return new NextResponse('not found', { status: 404 });
  // 총무·멤버 모두 내보낼 수 있다. 장부 열람 권한이 있는 사람에게 같은 내용을 파일로 주는
  // 것이므로 역할로 더 좁히지 않는다 — 좁혀도 멤버는 화면에서 같은 숫자를 볼 수 있다.

  const entries = await getAllEntries(groupId);
  const body = toCsvFile(
    COLUMNS,
    entries.map((e) => ({
      date: formatDateKst(e.occurredAt),
      kind: KIND_LABEL[e.type],
      amount: e.amount,
      category: e.category ?? '',
      memo: e.memo ?? '',
      reversalTarget: reversalTargetOf(e),
    })),
  );

  // 모임 이름은 사용자 입력이다 — `attachmentDisposition`이 헤더 주입·인용 탈출을 막고
  // 한글 이름을 RFC 5987 `filename*`로 싣는다. ASCII 폴백은 이름 없이 날짜만.
  // (`found.group`은 토큰이 든 행이지만 여기서는 `.name` 하나만 읽는다 — 행을 넘기지 않는다.)
  const today = formatDateKst(new Date());
  const namePart = safeFilenamePart(found.group.name);
  const fallback = `nbbang-ledger-${today}.csv`;

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': attachmentDisposition(
        namePart ? `nbbang-${namePart}-${today}.csv` : fallback,
        fallback,
      ),
      // 이 응답은 한 사람의 권한으로 만들어진 모임 재무 데이터다 — 공유 캐시에 남을 자리가 없다.
      'Cache-Control': 'private, no-store',
    },
  });
}
