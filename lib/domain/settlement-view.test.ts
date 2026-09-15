import { describe, it, expect } from 'vitest';
import {
  formatShareRange,
  NOTE_MESSAGES,
  previewSettlement,
  settlementShareText,
  settlementView,
  UNKNOWN_NAME,
  type ParticipantSnapshot,
  type SettlementNote,
  type TransferSnapshot,
} from '@/lib/domain/settlement-view';
import { minimalTransfers, splitEvenly } from '@/lib/domain/settlement';

/**
 * 이 스위트가 덮는 것은 **화면의 분기**다. 정산 상세는 async 서버 컴포넌트라
 * 렌더 단언에 세션과 DB가 필요하지만, 판단이 전부 이 순수 함수들에 있으므로
 * 여기서 DB 없이 고정된다(Plan 02의 overpaid 갭을 되풀이하지 않기 위한 구조).
 */

const P = (
  membershipId: string,
  displayNameAtTime: string,
  shareAmount: number,
  isPayer = false,
): ParticipantSnapshot => ({ membershipId, displayNameAtTime, shareAmount, isPayer });

const T = (id: string, from: string, to: string, amount: number): TransferSnapshot => ({
  id,
  fromMembershipId: from,
  toMembershipId: to,
  amount,
});

/** 3명이 10,000원을 나눈 정상 정산 — 나머지 1원이 앞사람(선결제자)에게 붙는다. */
function healthy() {
  return settlementView({
    title: '회식비',
    total: 10000,
    occurredOn: '2026-09-15',
    payerMembershipId: 'a',
    participants: [P('a', '민지', 3334, true), P('b', '철수', 3333), P('c', '영희', 3333)],
    transfers: [T('t1', 'b', 'a', 3333), T('t2', 'c', 'a', 3333)],
  });
}

describe('formatShareRange', () => {
  it('나누어떨어지면 한 값만 적는다', () => {
    expect(formatShareRange({ min: 10000, max: 10000 })).toBe('10,000');
  });

  it('갈리면 범위로 적는다 — 작은 값이 앞', () => {
    expect(formatShareRange({ min: 3333, max: 3334 })).toBe('3,333~3,334');
  });
});

describe('settlementView — 정상 정산', () => {
  it('1인 부담·이체 합계·인원을 그대로 뽑는다', () => {
    const v = healthy();
    expect(v.shareRange).toEqual({ min: 3333, max: 3334 });
    expect(v.shareLabel).toBe('3,333~3,334');
    expect(v.payerName).toBe('민지');
    expect(v.payerShare).toBe(3334);
    expect(v.participantCount).toBe(3);
    // 이 값이 이 화면의 핵심 수치다 — 총액 − 선결제자 부담액.
    expect(v.transferTotal).toBe(6666);
    expect(v.notes).toEqual([]);
  });

  it('이체의 이름은 스냅샷에서 푼다 — 현재 명단을 조인하지 않는다(ADR-003)', () => {
    expect(healthy().transfers).toEqual([
      { id: 't1', fromName: '철수', toName: '민지', amount: 3333 },
      { id: 't2', fromName: '영희', toName: '민지', amount: 3333 },
    ]);
  });

  it('입력 순서를 그대로 지킨다 — 정렬은 쿼리가 이미 정했다', () => {
    const v = settlementView({
      title: 'x',
      total: 300,
      occurredOn: '2026-09-15',
      payerMembershipId: 'a',
      participants: [P('a', '민지', 100, true), P('b', '철수', 100), P('c', '영희', 100)],
      transfers: [T('t2', 'c', 'a', 100), T('t1', 'b', 'a', 100)],
    });
    expect(v.transfers.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('참여자 1명이면 이체가 없고 그래도 정상이다', () => {
    const v = settlementView({
      title: '혼밥',
      total: 9000,
      occurredOn: '2026-09-15',
      payerMembershipId: 'a',
      participants: [P('a', '민지', 9000, true)],
      transfers: [],
    });
    expect(v.transferTotal).toBe(0);
    expect(v.notes).toEqual([]);
    expect(v.shareLabel).toBe('9,000');
  });
});

describe('settlementView — 알림 분기 (화면이 설명을 붙여야 하는 경우)', () => {
  const noteFor = (over: Partial<Parameters<typeof settlementView>[0]>): SettlementNote[] =>
    settlementView({
      title: '회식비',
      total: 10000,
      occurredOn: '2026-09-15',
      payerMembershipId: 'a',
      participants: [P('a', '민지', 3334, true), P('b', '철수', 3333), P('c', '영희', 3333)],
      transfers: [T('t1', 'b', 'a', 3333), T('t2', 'c', 'a', 3333)],
      ...over,
    }).notes;

  it('부담액이 0원인 참여자가 있으면 알린다 — 빠진 게 아니라 0원이라는 설명', () => {
    expect(
      noteFor({
        total: 1,
        participants: [P('a', '민지', 1, true), P('b', '철수', 0), P('c', '영희', 0)],
        transfers: [],
      }),
    ).toEqual(['ZERO_SHARE']);
  });

  it('선결제자가 참여자 명단에 없으면 알린다', () => {
    expect(
      noteFor({
        payerMembershipId: 'zzz',
        transfers: [T('t1', 'b', 'zzz', 3333), T('t2', 'c', 'zzz', 3333)],
      }),
    ).toContain('NO_PAYER');
  });

  it('머리말의 선결제자와 참여자 행의 isPayer가 어긋나면 알린다 — 두 컬럼을 함께 본다', () => {
    // 이름은 풀리므로(a가 명단에 있다) 이름 조회만으로는 못 잡는 어긋남이다.
    expect(noteFor({ participants: [P('a', '민지', 3334), P('b', '철수', 3333), P('c', '영희', 3333)] })).toContain(
      'NO_PAYER',
    );
  });

  it('부담액 합계가 총액과 다르면 알린다', () => {
    expect(noteFor({ total: 10001 })).toContain('SHARE_SUM_MISMATCH');
  });

  it('이체 합계가 총액 − 선결제자 부담액과 다르면 알린다', () => {
    expect(noteFor({ transfers: [T('t1', 'b', 'a', 3333)] })).toContain('TRANSFER_SUM_MISMATCH');
  });

  it('이체 상대가 참여자 명단에 없으면 이름을 대체하고 알린다', () => {
    const v = settlementView({
      title: '회식비',
      total: 10000,
      occurredOn: '2026-09-15',
      payerMembershipId: 'a',
      participants: [P('a', '민지', 3334, true), P('b', '철수', 3333), P('c', '영희', 3333)],
      transfers: [T('t1', 'b', 'a', 3333), T('t2', 'zzz', 'a', 3333)],
    });
    expect(v.transfers[1].fromName).toBe(UNKNOWN_NAME);
    expect(v.notes).toContain('UNKNOWN_MEMBER');
  });

  it('참여자가 없으면 알리고 범위는 0원으로 떨어진다 — Math.min(...[])의 −Infinity를 막는다', () => {
    const v = settlementView({
      title: '빈 정산',
      total: 10000,
      occurredOn: '2026-09-15',
      payerMembershipId: 'a',
      participants: [],
      transfers: [],
    });
    expect(v.shareRange).toEqual({ min: 0, max: 0 });
    expect(v.shareLabel).toBe('0');
    expect(v.notes).toContain('NO_PARTICIPANTS');
  });

  it('선결제자를 못 찾으면 이체 합계 알림을 겹쳐 내지 않는다 — 원인 하나에 줄 하나', () => {
    const notes = noteFor({
      payerMembershipId: 'zzz',
      transfers: [T('t1', 'b', 'zzz', 3333), T('t2', 'c', 'zzz', 3333)],
    });
    expect(notes).toContain('NO_PAYER');
    expect(notes).not.toContain('TRANSFER_SUM_MISMATCH');
  });

  it('알림 순서는 코드가 고정한다 — 같은 정산을 두 사람이 같은 순서로 읽는다', () => {
    const notes = noteFor({
      total: 3,
      payerMembershipId: 'zzz',
      participants: [P('a', '민지', 1), P('b', '철수', 0), P('c', '영희', 0)],
      transfers: [T('t1', 'b', 'qqq', 5)],
    });
    expect(notes).toEqual(['NO_PAYER', 'SHARE_SUM_MISMATCH', 'UNKNOWN_MEMBER', 'ZERO_SHARE']);
  });

  it('모든 코드에 한국어 문구가 있다', () => {
    for (const code of Object.keys(NOTE_MESSAGES) as SettlementNote[]) {
      expect(NOTE_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });
});

describe('settlementShareText', () => {
  it('플랜 형식 + 날짜, 나누어떨어지는 정산', () => {
    expect(
      settlementShareText({
        title: '회식비',
        occurredOn: '2026-09-15',
        total: 30000,
        participantCount: 3,
        shareRange: { min: 10000, max: 10000 },
        transfers: [
          { id: '1', fromName: '철수', toName: '민지', amount: 10000 },
          { id: '2', fromName: '영희', toName: '민지', amount: 10000 },
        ],
      }),
    ).toBe(
      '[회식비] 2026-09-15 · 총 30,000원 · 3명 (1인 10,000원)\n' +
        '철수 → 민지 10,000원\n' +
        '영희 → 민지 10,000원',
    );
  });

  it('나누어떨어지지 않으면 1인 금액을 범위로 적는다 — 한 값으로 적으면 이체 줄과 어긋난다', () => {
    expect(healthy().shareText).toBe(
      '[회식비] 2026-09-15 · 총 10,000원 · 3명 (1인 3,333~3,334원)\n' +
        '철수 → 민지 3,333원\n' +
        '영희 → 민지 3,333원',
    );
  });

  it('이체가 없으면 머리줄만 남기지 않고 이체 없음을 적는다', () => {
    const text = settlementShareText({
      title: '혼밥',
      occurredOn: '2026-09-15',
      total: 9000,
      participantCount: 1,
      shareRange: { min: 9000, max: 9000 },
      transfers: [],
    });
    expect(text).toBe('[혼밥] 2026-09-15 · 총 9,000원 · 1명 (1인 9,000원)\n이체 없음');
  });

  it('settlementView가 같은 문구를 내놓는다 — 화면과 복사 문구가 갈리지 않는다', () => {
    const v = healthy();
    expect(v.shareText).toBe(
      settlementShareText({
        title: '회식비',
        occurredOn: '2026-09-15',
        total: 10000,
        participantCount: 3,
        shareRange: v.shareRange,
        transfers: v.transfers,
      }),
    );
  });
});

describe('previewSettlement', () => {
  it('저장 전 미리보기가 저장 후 상세와 같은 수치를 낸다 — 같은 도메인 함수를 쓴다', () => {
    const p = previewSettlement(10000, ['a', 'b', 'c'], 'a');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.shareLabel).toBe('3,333~3,334');
    expect(p.payerShare).toBe(3334);
    expect(p.transferCount).toBe(2);
    expect(p.transferTotal).toBe(6666);
    // 서버가 다시 계산해 저장하는 값과 일치함을 같은 스위트에서 못 박는다.
    const shares = splitEvenly(10000, ['a', 'b', 'c']);
    expect(minimalTransfers(shares, 'a', 10000).reduce((n, t) => n + t.amount, 0)).toBe(p.transferTotal);
  });

  it('나누어떨어지면 범위가 한 값으로 접힌다', () => {
    const p = previewSettlement(30000, ['a', 'b', 'c'], 'a');
    expect(p.ok && p.shareLabel).toBe('10,000');
  });

  it('규칙 위반은 던지지 않고 코드로 돌려준다 — 타이핑 중간 상태는 오류가 아니다', () => {
    // 폼이 지나가는 상태들: 금액 미입력(NaN), 전원 해제, 선결제자 체크 해제.
    expect(previewSettlement(Number.NaN, ['a'], 'a')).toEqual({ ok: false, code: 'INVALID_AMOUNT' });
    expect(previewSettlement(0, ['a'], 'a')).toEqual({ ok: false, code: 'INVALID_AMOUNT' });
    expect(previewSettlement(10000, [], 'a')).toEqual({ ok: false, code: 'NO_PARTICIPANTS' });
    expect(previewSettlement(10000, ['b', 'c'], 'a')).toEqual({
      ok: false,
      code: 'PAYER_NOT_PARTICIPANT',
    });
  });

  it('참여자 1명이면 이체 0건이다', () => {
    const p = previewSettlement(9000, ['a'], 'a');
    expect(p.ok && p.transferCount).toBe(0);
    expect(p.ok && p.transferTotal).toBe(0);
  });

  it('0원 참여자가 생겨도 미리보기는 계산을 내놓는다 — 규칙 위반이 아니다', () => {
    const p = previewSettlement(1, ['a', 'b', 'c'], 'a');
    expect(p.ok).toBe(true);
    expect(p.ok && p.shareLabel).toBe('0~1');
    expect(p.ok && p.transferCount).toBe(0);
  });
});
