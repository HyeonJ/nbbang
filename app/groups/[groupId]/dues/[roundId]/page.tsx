import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActiveSession } from '@/lib/session';
import {
  getGroupForMember,
  getGroupMembers,
  getRound,
  getRoundPaidMembershipIds,
  getRoundRoster,
} from '@/lib/db/queries';
import { noticeNames, rosterLabel, roundTotals, unpaidMembers } from '@/lib/domain/dues';
import { formatAmount } from '@/lib/format';
import { Amount } from '@/components/ui/amount';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/ui/text-link';
import PaymentToggle from './payment-toggle';
import { RosterAddButton, RosterRemoveButton } from './roster-actions';
import UnpaidNotice from './unpaid-notice';

/**
 * 회차 화면 — 확정안 Q2 = B (direction.md 화면 결정).
 * 이 화면의 목적은 명단 열람이 아니라 미납 처리다: 상단 3수치 → 미납자 먼저 → 완료자는 접기 → 하단 복사 문구.
 */
export default async function RoundPage({
  params,
}: {
  params: Promise<{ groupId: string; roundId: string }>;
}) {
  const { groupId, roundId } = await params;

  const session = await getActiveSession();
  if (!session) redirect(`/login?next=/groups/${groupId}/dues/${roundId}`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  // 회차를 모임으로 스코프해 읽는다 — 남의 모임 roundId는 null이 되어 여기서 404로 끝난다.
  const round = await getRound(groupId, roundId);
  if (!round) notFound();

  const isOwner = found.membership.role === 'owner';
  const [roster, paidIds, members] = await Promise.all([
    getRoundRoster(round.id),
    getRoundPaidMembershipIds(round.id),
    getGroupMembers(groupId),
  ]);

  // 수치·미납·납부는 모두 **회차 명단**에서 나온다 — 지금 명단이 아니다(ADR-005 D1).
  // 납부는 명단 안에서만 존재하므로(dues_payments_roster_fk) 미납액이 음수가 될 수 없다.
  const paidSet = new Set(paidIds);
  const unpaid = unpaidMembers(roster, paidIds);
  const paid = roster.filter((m) => paidSet.has(m.membershipId));
  const { expected, collected, outstanding } = roundTotals(round.amountPerPerson, roster.length, paidIds);

  // 명단 추가 후보 — 활동 중인데 이 회차 명단에 없는 사람(월 중간 합류자 등).
  const inRoster = new Set(roster.map((m) => m.membershipId));
  const addable = members.filter((m) => !inRoster.has(m.id));

  // 단톡방 문구에는 활동 중인 미납자만 — 나간 사람은 그 방에 없다. 나간 미납자는 화면에만 남는다.
  const names = noticeNames(unpaid);

  /**
   * 미납 안내 문구 (F6 완결) — 단톡방에 그대로 붙는 두 줄이다.
   *
   *   2026-01 회비(20,000원) 미납: 철수, 영희
   *   계좌: 카카오뱅크 3333-01-1234567 정현인
   *
   * 계좌가 없으면 **둘째 줄을 넣지 않는다** — 빈 `계좌:`는 없는 것보다 나쁘다.
   * `accountLabel`은 `''`로 저장되지 않으므로(actions/group.ts) 여기서는 null 검사 하나로 끝난다.
   * 이 문구는 인증된 회차 화면에만 있다 — 공개 장부·CSV에는 계좌가 나가지 않는다(schema.ts 3줄 규칙).
   */
  const accountLabel = found.group.accountLabel;
  const notice = [
    `${round.period} 회비(${formatAmount(round.amountPerPerson)}원) 미납: ${names.join(', ')}`,
    ...(accountLabel ? [`계좌: ${accountLabel}`] : []),
  ].join('\n');

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader
        back={`/groups/${groupId}/dues`}
        title={`${round.period} 회비`}
        right={
          <span className="text-right">
            <span className="font-display block text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
              1인 금액
            </span>
            {/* 1인 금액은 회차의 조건이지 들어온 돈이 아니다 — 이 화면에서 오렌지는 '수납' 하나만 뜻한다. */}
            <Amount value={round.amountPerPerson} size="lg" unit tone="plain" />
          </span>
        }
      />
      <GroupTabs groupId={groupId} isOwner={isOwner} />

      <section className="mt-7 border-b-2 border-ink">
        <div className="grid grid-cols-3">
          <Stat label="예상" testId="round-total-expected">
            <Amount value={expected} size="md" unit tone="plain" />
          </Stat>
          <Stat label="수납" testId="round-total-collected" divider>
            {/* 화면에서 오렌지가 갖는 의미는 하나 — '들어온 돈'. 예상·미납은 잉크로 둔다. */}
            <Amount value={collected} size="md" unit />
          </Stat>
          <Stat label="미납" testId="round-total-outstanding" divider>
            <Amount value={outstanding} size="md" unit tone="plain" />
          </Stat>
        </div>
      </section>

      <section className="pt-7">
        {/* 할 일이 맨 위 — 인원이 늘어도 미납자를 찾아 스크롤하지 않는다. */}
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-accent-deep uppercase">
          미납 {unpaid.length}명
        </h2>
        <div className="mt-4">
          <DataTable>
            {unpaid.length === 0 ? (
              <Row>
                <Cell className="text-muted">전원 납부했습니다.</Cell>
              </Row>
            ) : (
              unpaid.map((m) => (
                <Row key={m.membershipId} testId="payment-row">
                  <Cell>{rosterLabel(m)}</Cell>
                  <Cell align="right">
                    {isOwner ? (
                      <span className="inline-flex items-start gap-2">
                        <RosterRemoveButton
                          groupId={groupId}
                          roundId={round.id}
                          membershipId={m.membershipId}
                          displayName={m.displayName}
                          left={m.left}
                        />
                        <PaymentToggle
                          groupId={groupId}
                          roundId={round.id}
                          membershipId={m.membershipId}
                          displayName={m.displayName}
                          paid={false}
                        />
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted">미납</span>
                    )}
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>
      </section>

      {/* 끝난 사람은 접어 둔다 — 확인은 언제든 가능하되 화면의 주인공은 아니다. */}
      <details className="mt-7 border-t-2 border-ink" data-testid="paid-details">
        <summary className="font-display cursor-pointer py-3.5 text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          납부 완료 {paid.length}명
        </summary>
        <div className="pb-2">
          <DataTable>
            {paid.length === 0 ? (
              <Row>
                <Cell className="text-muted">아직 납부한 사람이 없습니다.</Cell>
              </Row>
            ) : (
              paid.map((m) => (
                <Row key={m.membershipId} testId="payment-row">
                  <Cell>{rosterLabel(m)}</Cell>
                  <Cell align="right">
                    {isOwner ? (
                      <PaymentToggle
                        groupId={groupId}
                        roundId={round.id}
                        membershipId={m.membershipId}
                        displayName={m.displayName}
                        paid
                      />
                    ) : (
                      <span className="text-[12px] text-muted">완료</span>
                    )}
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>
      </details>

      {isOwner && addable.length > 0 ? (
        <section className="mt-7 border-t-2 border-ink pt-4" data-testid="roster-addable">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
            명단에 없는 멤버
          </h2>
          <p className="mt-2 text-[12px] leading-[1.7] text-muted">
            이 회차 명단에 없는 활동 멤버입니다(나중에 합류했거나 면제된 사람). 내야 하면 추가하세요.
          </p>
          <div className="mt-3">
            <DataTable>
              {addable.map((m) => (
                <Row key={m.id} testId="roster-addable-row">
                  <Cell>{m.displayName}</Cell>
                  <Cell align="right">
                    <RosterAddButton
                      groupId={groupId}
                      roundId={round.id}
                      membershipId={m.id}
                      displayName={m.displayName}
                    />
                  </Cell>
                </Row>
              ))}
            </DataTable>
          </div>
        </section>
      ) : null}

      {/* F6의 핵심 — 총무의 마지막 동선은 단톡방 독촉이다. 계좌가 설정돼 있으면 문구에 함께 실린다. */}
      {names.length > 0 ? (
        <section className="mt-7 border-2 border-ink p-4">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
            미납 안내 문구
          </h2>
          <UnpaidNotice text={notice} />
          {/* 계좌가 없으면 총무에게만 가는 길을 알려준다 — 멤버는 바꿀 수 없으므로 보여주지 않는다. */}
          {!accountLabel && isOwner ? (
            <p className="mt-3 text-[12px] leading-[1.7] text-muted" data-testid="account-hint">
              <TextLink
                className="font-bold text-ink underline"
                href={`/groups/${groupId}/settings`}
              >
                설정에서 입금 계좌를 등록
              </TextLink>
              하면 이 문구에 계좌 줄이 함께 붙습니다.
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

/** 3수치 한 칸 — 라벨 위, 숫자 아래. 두 번째·세 번째 칸만 1px 세로 괘선으로 나눈다(시안 Q2-B). */
function Stat({
  label,
  testId,
  divider = false,
  children,
}: {
  label: string;
  testId: string;
  divider?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`py-5 ${divider ? 'border-l border-hairline pl-4' : ''}`}>
      <div className="font-display text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
        {label}
      </div>
      <div className="mt-1.5" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}
