import { notFound, redirect } from 'next/navigation';
import { getActiveSession } from '@/lib/session';
import { getBalance, getGroupForMember, getGroupMembers, getRecentEntries } from '@/lib/db/queries';
import { formatDateKst } from '@/lib/format';
import { Amount } from '@/components/ui/amount';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader, RoleBadge } from '@/components/ui/page-header';

export default async function GroupDashboardPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await getActiveSession();
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
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">최근 기록</h2>
          {/*
            CSV 내보내기(F7) — 총무·멤버 **모두**. 열람 권한이 있으면 파일로도 받을 수 있다.
            개요 화면에 두는 이유: 이 화면이 원장을 보여주는 곳이고(아래 표), 설정 탭은
            총무 전용이라 거기 두면 멤버가 닿지 못한다(플랜은 설정 화면을 지목했지만
            그 화면은 `role !== 'owner'`를 404로 떨어뜨린다 — 같은 태스크의 두 문장이 어긋났다).

            `next/link`가 아니라 평범한 `<a>`다: 이것은 화면 이동이 아니라 **파일 다운로드**다.
            Link는 RSC 프리페치·클라이언트 내비게이션을 걸어 attachment 응답과 맞지 않는다.
          */}
          <a
            href={`/api/groups/${groupId}/export`}
            data-testid="export-csv"
            className="font-display text-[11px] font-bold tracking-[0.1em] text-muted uppercase underline decoration-hairline decoration-2 underline-offset-4 hover:text-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            CSV 내보내기
          </a>
        </div>
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
