import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getGroupForMember, getRound } from '@/lib/db/queries';
import { Amount } from '@/components/ui/amount';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader } from '@/components/ui/page-header';

// 임시 자리표 — Plan 02 Task 9가 납부 체크 그리드(3수치·미납자·복사 문구)로 교체한다.
// 목록의 회차 링크가 404로 끝나지 않게 하는 최소 페이지.
export default async function RoundPlaceholderPage({
  params,
}: {
  params: Promise<{ groupId: string; roundId: string }>;
}) {
  const { groupId, roundId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=/groups/${groupId}/dues/${roundId}`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  // 회차를 모임으로 스코프해 읽는다 — 남의 모임 roundId는 null이 되어 여기서 404로 끝난다.
  const round = await getRound(groupId, roundId);
  if (!round) notFound();

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
            <Amount value={round.amountPerPerson} size="lg" unit />
          </span>
        }
      />
      <GroupTabs groupId={groupId} isOwner={found.membership.role === 'owner'} />
      <p className="mt-7 border-t-2 border-ink py-6 text-[14px] text-muted">납부 체크는 준비 중입니다.</p>
    </main>
  );
}
