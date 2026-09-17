import { notFound, redirect } from 'next/navigation';
import { getActiveSession } from '@/lib/session';
import { getGroupForMember, getGroupMembers } from '@/lib/db/queries';
import { formatDateKst } from '@/lib/format';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader } from '@/components/ui/page-header';
import SettleForm from './settle-form';

/**
 * 정산 마법사 (F4). 이 화면은 게이트 + 데이터 조회만 한다 — 계산과 분기는 폼(클라이언트)과
 * `lib/domain/settlement-view.ts`(순수)가 갖는다.
 *
 * 총무가 아니면 `notFound()`다. 액션도 `assertOwner`로 막지만, 만들 수 없는 화면을
 * 보여 주는 것 자체가 거짓 약속이다 — 목록에 '정산 만들기' 버튼도 나오지 않는다.
 */
export default async function NewSettlementPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;

  const session = await getActiveSession();
  if (!session) redirect(`/login?next=/groups/${groupId}/settle/new`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();
  if (found.membership.role !== 'owner') notFound();

  const members = await getGroupMembers(groupId);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader back={`/groups/${groupId}/settle`} title="정산 만들기" />
      <GroupTabs groupId={groupId} isOwner />

      <section className="pt-7">
        <SettleForm
          groupId={groupId}
          members={members.map((m) => ({ id: m.id, displayName: m.displayName }))}
          selfMembershipId={found.membership.id}
          // 오늘 날짜는 서버(KST)에서 만들어 넘긴다 — 클라이언트 시계로 만들면 하이드레이션이 어긋난다.
          today={formatDateKst(new Date())}
        />
      </section>
    </main>
  );
}
