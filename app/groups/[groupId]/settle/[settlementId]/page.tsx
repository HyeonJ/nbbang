import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getActiveSession } from '@/lib/session';
import { getGroupForMember, getSettlement } from '@/lib/db/queries';
import { NOTE_MESSAGES, settlementView } from '@/lib/domain/settlement-view';
import { formatDateKst } from '@/lib/format';
import { Amount } from '@/components/ui/amount';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader } from '@/components/ui/page-header';
import ShareText from './share-text';

/**
 * 정산 결과 상세 (F4). 이 컴포넌트는 **읽어서 넘기기만 한다** — 1인 부담 표기, 이름 풀기,
 * "이 정산이 이상해 보이나", 공유 문구는 전부 `lib/domain/settlement-view.ts`의 순수 함수가
 * 결정하고 단위 테스트가 덮는다(async 서버 컴포넌트 안의 분기는 테스트할 수 없다는 회고 반영).
 *
 * 모든 이름은 `displayNameAtTime` 스냅샷이다 — 이름이 바뀌거나 멤버가 떠나도 이 화면은
 * 변하지 않는다(ADR-003). 금액은 전부 tone='plain'이다: 정산은 모임 돈이 아니다.
 */
export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ groupId: string; settlementId: string }>;
}) {
  const { groupId, settlementId } = await params;

  const session = await getActiveSession();
  if (!session) redirect(`/login?next=/groups/${groupId}/settle/${settlementId}`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  // 정산을 모임으로 스코프해 읽는다 — 남의 모임 id는 null이 되어 여기서 404로 끝난다.
  const detail = await getSettlement(groupId, settlementId);
  if (!detail) notFound();

  const isOwner = found.membership.role === 'owner';
  const { settlement, participants, transfers } = detail;
  const occurredOn = formatDateKst(settlement.occurredAt);
  const view = settlementView({
    title: settlement.title,
    total: settlement.total,
    occurredOn,
    payerMembershipId: settlement.payerMembershipId,
    participants,
    transfers,
  });

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader
        back={`/groups/${groupId}/settle`}
        title={settlement.title}
        right={
          <span className="text-right">
            <span className="font-display block text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
              총액
            </span>
            {/* 마법사의 입력이 `settle-total`이므로 결과 화면은 이름을 갈라 둔다. */}
            <span data-testid="settle-detail-total">
              <Amount value={settlement.total} size="lg" unit tone="plain" />
            </span>
          </span>
        }
      />
      <GroupTabs groupId={groupId} isOwner={isOwner} />

      <section className="mt-7 border-b-2 border-ink">
        <div className="grid grid-cols-2 sm:grid-cols-3">
          <Stat label="일자" testId="settle-occurred-on">
            <span className="num text-[15px]">{occurredOn}</span>
          </Stat>
          <Stat label="참여" testId="settle-participant-count" className="border-l border-hairline pl-4">
            <span className="num text-[15px]">
              {view.participantCount}
              <span className="text-[12px] font-medium">명</span>
            </span>
          </Stat>
          {/*
            1인 부담은 나머지가 갈리면 '3,333~3,334원'이 되어 390px 3분할에 들어가지 않는다
            (실측: 단위가 줄바꿈됐다). 모바일은 한 행을 통째로 쓰고 sm부터 3분할로 돌아간다
            — direction.md의 "컬럼 수를 줄이지 말고 행을 재구성".
          */}
          <Stat
            label="1인 부담"
            testId="settle-per-share"
            className="col-span-2 border-t border-hairline sm:col-span-1 sm:border-t-0 sm:border-l sm:pl-4"
          >
            <span className="num text-[15px]">
              {view.shareLabel}
              <span className="text-[12px] font-medium">원</span>
            </span>
          </Stat>
        </div>
        {/* 알림은 순수 함수가 코드로 판정하고, 여기서는 문구만 꺼낸다 — 분기가 화면에 없다. */}
        {view.notes.map((note) => (
          <p
            key={note}
            role="alert"
            data-testid="settle-note"
            className="mb-5 border-l-2 border-ink pl-3 text-[13px] leading-[1.7]"
          >
            {NOTE_MESSAGES[note]}
          </p>
        ))}
      </section>

      <section className="pt-7">
        <div className="flex items-baseline justify-between">
          {/* 화면의 주인공 — "누가 누구에게 얼마". 선결제자 한 명이 받으므로 최대 n−1줄이다. */}
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
            이체 {view.transfers.length}건
          </h2>
          <span className="font-display text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
            합계{' '}
            <span data-testid="settle-transfer-total" className="text-ink">
              <Amount value={view.transferTotal} size="md" unit tone="plain" />
            </span>
          </span>
        </div>
        <div className="mt-4">
          <DataTable>
            {view.transfers.length === 0 ? (
              <Row>
                <Cell className="text-muted">보낼 이체가 없습니다.</Cell>
              </Row>
            ) : (
              view.transfers.map((t) => (
                <Row key={t.id} testId="settle-transfer-row">
                  <Cell>
                    {t.fromName}
                    <span className="font-display mx-2 text-muted">→</span>
                    <span className="font-bold">{t.toName}</span>
                  </Cell>
                  <Cell align="right">
                    <Amount value={t.amount} size="md" unit tone="plain" />
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>
      </section>

      <section className="pt-7">
        {/* 선결제자와 0원 참여자도 전원 남는다(ADR-003 스냅샷) — 이체 목록만으로는 명단이 복원되지 않는다. */}
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          참여자
        </h2>
        <div className="mt-4">
          <DataTable>
            {participants.map((p) => (
              <Row key={p.membershipId} testId="settle-participant-row">
                <Cell>
                  {p.displayNameAtTime}
                  {p.isPayer ? (
                    <span className="font-display ml-2 border border-ink px-1.5 py-0.5 align-middle text-[10px] font-bold tracking-[0.1em]">
                      선결제
                    </span>
                  ) : null}
                </Cell>
                <Cell align="right">
                  <span data-testid="settle-share-amount">
                    <Amount value={p.shareAmount} size="md" unit tone="plain" />
                  </span>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </div>
      </section>

      {/* 총무의 마지막 동선은 단톡방 공유다 — 문구를 만들어 두고 복사만 하게 한다. */}
      <section className="mt-7 border-2 border-ink p-4">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          공유 문구
        </h2>
        <ShareText text={view.shareText} />
      </section>
    </main>
  );
}

/**
 * 3수치 한 칸 — 회차 화면과 같은 규칙(라벨 위, 수치 아래, 1px 세로 괘선으로 나눔).
 * 괘선은 boolean 플래그가 아니라 className으로 받는다 — 이 화면은 폭에 따라 세로/가로
 * 괘선이 바뀌므로 "구분선 있음/없음" 두 값으로는 표현되지 않는다.
 */
function Stat({
  label,
  testId,
  className = '',
  children,
}: {
  label: string;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`py-5 ${className}`}>
      <div className="font-display text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
        {label}
      </div>
      <div className="mt-1.5" data-testid={testId}>
        {children}
      </div>
    </div>
  );
}
