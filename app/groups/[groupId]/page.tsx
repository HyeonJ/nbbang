import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getGroupForMember, getGroupMembers } from '@/lib/db/queries';
import { Amount } from '@/components/ui/amount';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader, RoleBadge } from '@/components/ui/page-header';

export default async function GroupDashboardPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=/groups/${groupId}`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  const { group, membership } = found;
  const members = await getGroupMembers(groupId);

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
          {/* Plan 02 Task 4에서 원장(ledger_entries) 합산으로 교체 — 잔액은 저장하지 않는 파생값 */}
          <Amount value={0} size="xl" unit />
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
        <p className="mt-4 border-t-2 border-ink py-6 text-[14px] text-muted">
          아직 기록이 없습니다. 회비·지출은 준비 중입니다.
        </p>
      </section>
    </main>
  );
}
