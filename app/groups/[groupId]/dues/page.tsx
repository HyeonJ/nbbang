import { notFound, redirect } from 'next/navigation';
import { getActiveSession } from '@/lib/session';
import { getGroupForMember, getGroupMembers, getRoundsWithCounts } from '@/lib/db/queries';
import { formatDateKst } from '@/lib/format';
import { Amount } from '@/components/ui/amount';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader } from '@/components/ui/page-header';
import { TextLink } from '@/components/ui/text-link';
import RoundForm from './round-form';

export default async function DuesPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await getActiveSession();
  if (!session) redirect(`/login?next=/groups/${groupId}/dues`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  const isOwner = found.membership.role === 'owner';
  const [members, rounds] = await Promise.all([getGroupMembers(groupId), getRoundsWithCounts(groupId)]);
  const memberCount = members.length;

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader back={`/groups/${groupId}`} title="회비" />
      <GroupTabs groupId={groupId} isOwner={isOwner} />

      {isOwner ? (
        <section className="border-b-2 border-ink py-7" data-testid="round-form">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">회차 만들기</h2>
          <div className="mt-4">
            {/* 기본 기간은 서버(KST)에서 계산해 넘긴다 — 클라이언트 시계로 만들면 하이드레이션이 어긋난다. */}
            <RoundForm groupId={groupId} thisMonth={formatDateKst(new Date()).slice(0, 7)} />
          </div>
        </section>
      ) : null}

      <section className="pt-7">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">회차</h2>
        <div className="mt-4">
          <DataTable>
            {rounds.length === 0 ? (
              <Row>
                <Cell className="text-muted">아직 회차가 없습니다.</Cell>
              </Row>
            ) : (
              rounds.map((r) => (
                <Row key={r.id} testId="round-row">
                  <Cell>
                    <TextLink
                      href={`/groups/${groupId}/dues/${r.id}`}
                      data-testid="round-link"
                      className="num font-bold"
                    >
                      {r.period}
                    </TextLink>
                  </Cell>
                  <Cell align="right" className="text-muted">
                    <span className="font-display mr-1.5 text-[10px] font-bold tracking-[0.14em] uppercase">
                      1인
                    </span>
                    <Amount value={r.amountPerPerson} size="md" />
                  </Cell>
                  <Cell align="right">
                    {/* 납부 n/N — N은 '지금 명단'이다. 과거 회차도 현재 인원 기준으로 읽힌다(roundTotals와 같은 한계). */}
                    <span className="num" data-testid="round-paid-count">
                      {r.paidCount}/{memberCount}
                    </span>
                  </Cell>
                  <Cell align="right">
                    {/* 수납액 = 1인 금액 × 납부 인원 (roundTotals.collected와 같은 규칙 — 여기는 인원 수만 있다). */}
                    <span data-testid="round-collected">
                      <Amount value={r.amountPerPerson * r.paidCount} size="md" unit />
                    </span>
                  </Cell>
                </Row>
              ))
            )}
          </DataTable>
        </div>
      </section>
    </main>
  );
}
