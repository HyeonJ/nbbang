import { formatAmount } from '@/lib/format';
import { minimalTransfers, SettlementRuleError, splitEvenly } from './settlement';

/**
 * 정산 화면의 **표시 판단**을 담는 순수 모듈.
 *
 * 왜 화면이 아니라 여기인가 (Plan 02 회고): 회차 화면의 `overpaid` 분기는 async 서버
 * 컴포넌트 안에 살아서 세션과 DB 없이는 한 줄도 테스트할 수 없다 — 그게 남은 테스트 갭이다.
 * 같은 실수를 반복하지 않으려고, 정산 화면이 내리는 모든 판단("1인 얼마로 적을까",
 * "이 정산이 이상해 보이나", "공유 문구는 뭐라고 쓰나")을 입출력이 전부 값인 함수로 옮겼다.
 * 서버 컴포넌트는 읽어서 넘기기만 하고, 분기는 전부 이 파일의 단위 테스트가 덮는다.
 *
 * 이름은 전부 스냅샷(`displayNameAtTime`)에서 온다 — 현재 명단을 조인하지 않는다(ADR-003).
 */

/** 이체가 참여자 스냅샷에 없는 멤버십을 가리킬 때 쓰는 대체 이름. */
export const UNKNOWN_NAME = '(알 수 없음)';

export type ParticipantSnapshot = {
  membershipId: string;
  displayNameAtTime: string;
  shareAmount: number;
  isPayer: boolean;
};

export type TransferSnapshot = {
  id: string;
  fromMembershipId: string;
  toMembershipId: string;
  amount: number;
};

/** 1인 부담액. 나머지가 갈리면 min < max이고 차이는 언제나 1원이다(splitEvenly의 불변식). */
export type ShareRange = { min: number; max: number };

/**
 * "이 정산이 이상해 보인다"를 뜻하는 코드.
 *
 * 전부 **지금은 도달 불가**하다 — 액션이 도메인 함수로 계산해 한 트랜잭션에 적재하고,
 * 복합 FK가 모임 경계를 잡고 있다. 그래도 화면이 조용히 틀린 수치를 보여주는 것보다는
 * 어긋났다고 말하는 편이 낫다. 정산은 사람들이 돈을 보내는 근거이기 때문이다.
 */
export type SettlementNote =
  | 'NO_PARTICIPANTS'
  | 'NO_PAYER'
  | 'ZERO_SHARE'
  | 'SHARE_SUM_MISMATCH'
  | 'TRANSFER_SUM_MISMATCH'
  | 'UNKNOWN_MEMBER';

/**
 * 코드 → 한국어. `Record<SettlementNote, string>`이라 코드를 추가하면 **컴파일이 깨져**
 * 문구를 빠뜨릴 수 없다. 공유 문구도 이 모듈이 한국어로 만들므로 자리가 어긋나지 않는다.
 */
export const NOTE_MESSAGES: Record<SettlementNote, string> = {
  NO_PARTICIPANTS: '참여자 기록이 없습니다 — 정산 데이터가 손상됐을 수 있습니다.',
  NO_PAYER: '선결제자가 참여자 명단에 없습니다 — 정산 데이터가 손상됐을 수 있습니다.',
  ZERO_SHARE: '총액이 참여 인원보다 적어 부담액이 0원인 참여자가 있습니다.',
  SHARE_SUM_MISMATCH: '참여자 부담액의 합이 총액과 다릅니다.',
  TRANSFER_SUM_MISMATCH: '이체 합계가 총액에서 선결제자 부담액을 뺀 값과 다릅니다.',
  UNKNOWN_MEMBER: '이체 상대가 참여자 명단에 없습니다.',
};

/** 알림 순서를 코드에 고정한다 — 같은 정산을 두 사람이 봐도 같은 순서로 읽힌다. */
const NOTE_ORDER: readonly SettlementNote[] = [
  'NO_PARTICIPANTS',
  'NO_PAYER',
  'SHARE_SUM_MISMATCH',
  'TRANSFER_SUM_MISMATCH',
  'UNKNOWN_MEMBER',
  'ZERO_SHARE',
];

/** 화면에 그대로 그릴 이체 한 줄 — id는 그대로 두되 이름은 스냅샷에서 풀어 둔다. */
export type TransferRow = { id: string; fromName: string; toName: string; amount: number };

export type SettlementView = {
  shareRange: ShareRange;
  /** 1인 부담 표기. 나누어떨어지면 '10,000', 아니면 '3,333~3,334'. */
  shareLabel: string;
  payerName: string | null;
  payerShare: number;
  participantCount: number;
  transferTotal: number;
  transfers: TransferRow[];
  notes: SettlementNote[];
  shareText: string;
};

export type SettlementViewInput = {
  title: string;
  total: number;
  /** KST 날짜(YYYY-MM-DD). 서버에서 formatDateKst로 만들어 넘긴다 — 여기서 시계를 읽지 않는다. */
  occurredOn: string;
  payerMembershipId: string;
  participants: readonly ParticipantSnapshot[];
  transfers: readonly TransferSnapshot[];
};

const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);

/** 부담액 범위 → 표기. 두 값이 같으면 하나만 적는다(같은데 범위로 적으면 읽는 사람이 계산한다). */
export function formatShareRange({ min, max }: ShareRange): string {
  return min === max ? formatAmount(min) : `${formatAmount(min)}~${formatAmount(max)}`;
}

/**
 * 단톡방에 붙여 넣을 공유 문구.
 *
 * 플랜 원안은 머리줄이 `[제목] 총 30,000원 · 3명 (1인 10,000원)`이었다. 두 곳을 고쳤다:
 * ① **나누어떨어지지 않는 정산에서 원안은 거짓말을 한다.** 10,000원을 3명이 나누면 1인은
 *    3,334원과 3,333원인데 "1인 3,333원"이라고 한 줄로 적으면 아래 이체 금액과 어긋나고,
 *    받는 사람이 1원을 덜 받았다고 읽는다. 범위로 적는다(`3,333~3,334원`).
 * ② **날짜를 넣었다.** '회식비'는 반복되는 제목이라, 지난 정산 문구를 다시 붙였을 때
 *    어느 날 것인지 문구만 보고 알 수 없으면 되묻는 왕복이 생긴다.
 *
 * 이체가 0건인 정산(참여자 1명)은 본문이 비어 머리줄만 남으므로 '이체 없음'을 적는다.
 */
export function settlementShareText(input: {
  title: string;
  occurredOn: string;
  total: number;
  participantCount: number;
  shareRange: ShareRange;
  transfers: readonly TransferRow[];
}): string {
  const head =
    `[${input.title}] ${input.occurredOn} · 총 ${formatAmount(input.total)}원 · ` +
    `${input.participantCount}명 (1인 ${formatShareRange(input.shareRange)}원)`;
  const lines = input.transfers.map(
    (t) => `${t.fromName} → ${t.toName} ${formatAmount(t.amount)}원`,
  );
  return [head, ...(lines.length > 0 ? lines : ['이체 없음'])].join('\n');
}

/** 정산 상세 화면이 필요로 하는 값 전부. 서버 컴포넌트는 이 결과를 그리기만 한다. */
export function settlementView(input: SettlementViewInput): SettlementView {
  const { participants, transfers, total, payerMembershipId } = input;

  const nameById = new Map(participants.map((p) => [p.membershipId, p.displayNameAtTime]));
  const payerName = nameById.get(payerMembershipId) ?? null;
  const payerShare = participants.find((p) => p.membershipId === payerMembershipId)?.shareAmount ?? 0;

  const amounts = participants.map((p) => p.shareAmount);
  const shareRange: ShareRange =
    amounts.length === 0 ? { min: 0, max: 0 } : { min: Math.min(...amounts), max: Math.max(...amounts) };

  const rows: TransferRow[] = transfers.map((t) => ({
    id: t.id,
    fromName: nameById.get(t.fromMembershipId) ?? UNKNOWN_NAME,
    toName: nameById.get(t.toMembershipId) ?? UNKNOWN_NAME,
    amount: t.amount,
  }));
  const transferTotal = sum(transfers.map((t) => t.amount));

  const found = new Set<SettlementNote>();
  if (participants.length === 0) found.add('NO_PARTICIPANTS');
  // isPayer 플래그와 settlements.payer_membership_id는 서로 다른 컬럼이다 — 둘 다 봐야
  // "머리말이 가리키는 사람"과 "참여자 행이 선결제자라고 말하는 사람"의 어긋남을 잡는다.
  if (payerName === null || !participants.some((p) => p.isPayer && p.membershipId === payerMembershipId)) {
    found.add('NO_PAYER');
  }
  if (participants.length > 0 && sum(amounts) !== total) found.add('SHARE_SUM_MISMATCH');
  // 선결제자를 못 찾은 경우엔 이 검사를 건너뛴다 — payerShare가 0으로 떨어져 있어
  // 같은 원인 하나로 알림이 두 줄 나오기만 한다(NO_PAYER가 이미 그 사실을 말한다).
  if (payerName !== null && transferTotal !== total - payerShare) found.add('TRANSFER_SUM_MISMATCH');
  if (rows.some((r) => r.fromName === UNKNOWN_NAME || r.toName === UNKNOWN_NAME)) {
    found.add('UNKNOWN_MEMBER');
  }
  // 0원 참여자는 손상이 아니라 정상적인 극단이다(총액 < 인원) — 다만 설명 없이 보면
  // "왜 이 사람만 빠졌지"가 되므로 알림으로 말해 준다(ADR-003: 0원도 참여자로 남는다).
  if (amounts.some((a) => a === 0)) found.add('ZERO_SHARE');

  return {
    shareRange,
    shareLabel: formatShareRange(shareRange),
    payerName,
    payerShare,
    participantCount: participants.length,
    transferTotal,
    transfers: rows,
    notes: NOTE_ORDER.filter((n) => found.has(n)),
    shareText: settlementShareText({
      title: input.title,
      occurredOn: input.occurredOn,
      total,
      participantCount: participants.length,
      shareRange,
      transfers: rows,
    }),
  };
}

/**
 * 마법사의 실시간 미리보기.
 *
 * 규칙 위반을 예외가 아니라 값으로 돌려준다 — 폼은 타이핑 중간의 빈 금액·해제된 체크박스처럼
 * "아직 유효하지 않은 상태"를 계속 지나가므로, 그 자체는 오류가 아니라 **표시할 다음 문구**다.
 * 코드는 액션이 내는 것과 같은 어휘라 폼이 에러 사전을 두 벌 갖지 않는다.
 */
export type SettlementPreview =
  | {
      ok: true;
      shareRange: ShareRange;
      shareLabel: string;
      payerShare: number;
      transferCount: number;
      transferTotal: number;
    }
  | { ok: false; code: string };

export function previewSettlement(
  total: number,
  participantIds: readonly string[],
  payerId: string,
): SettlementPreview {
  try {
    const shares = splitEvenly(total, participantIds);
    const transfers = minimalTransfers(shares, payerId, total);
    const amounts = shares.map((s) => s.amount);
    const shareRange: ShareRange = { min: Math.min(...amounts), max: Math.max(...amounts) };
    return {
      ok: true,
      shareRange,
      shareLabel: formatShareRange(shareRange),
      payerShare: shares.find((s) => s.membershipId === payerId)?.amount ?? 0,
      transferCount: transfers.length,
      transferTotal: sum(transfers.map((t) => t.amount)),
    };
  } catch (e) {
    if (e instanceof SettlementRuleError) return { ok: false, code: e.code };
    throw e;
  }
}
