import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getBalance, getGroupForMember, getGroupMembers, getRecentEntries } from '@/lib/db/queries';
import { formatDateKst } from '@/lib/format';
import { Amount } from '@/components/ui/amount';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader, RoleBadge } from '@/components/ui/page-header';

export default async function GroupDashboardPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=/groups/${groupId}`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  const { group, membership } = found;
  const [members, balance, recent] = await Promise.all([
    getGroupMembers(groupId),
    getBalance(groupId),
    getRecentEntries(groupId),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader
        back="/groups"
        title={group.name}
        titleTestId="group-title"
        right={<RoleBadge role={membership.role === 'owner' ? 'owner' : 'member'} />}
      />
      <GroupTabs groupId={groupId} isOwner={membership.role === 'owner'} />

      <section className="border-b-2 border-ink py-7">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">현재 잔액</h2>
        <p className="mt-1" data-testid="group-balance">
          {/* 저장된 잔액 컬럼은 없다 — 매 요청 원장 합산으로만 구한다 (ADR-001) */}
          <Amount value={balance} size="xl" unit />
        </p>
      </section>

      <section className="grid grid-cols-2 border-b-2 border-ink">
        <div className="py-4">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">멤버</h2>
          <p className="num mt-1 text-[19px]">
            {members.length}
            <span className="text-[13px] font-medium">명</span>
          </p>
        </div>
        <div className="border-l border-hairline py-4 pl-4">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">이번 달 납부</h2>
          <p className="mt-1 text-[15px] text-muted">준비 중</p>
        </div>
      </section>

      <section className="pt-7">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">최근 기록</h2>
        <div className="mt-4">
          <DataTable>
            {recent.length === 0 ? (
              <Row>
                <Cell className="text-muted">아직 기록이 없습니다.</Cell>
              </Row>
            ) : (
              recent.map((e) => (
                <Row key={e.id} testId="recent-entry-row">
                  <Cell className="num w-[92px] text-muted">{formatDateKst(e.occurredAt)}</Cell>
                  <Cell>
                    {e.memo ?? (e.category ?? '기록')}
                    {e.memo && e.category ? (
                      <span className="ml-2 text-[12px] text-muted">{e.category}</span>
                    ) : null}
                  </Cell>
                  <Cell align="right">
                    <Amount value={e.amount} size="md" showSign />
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
