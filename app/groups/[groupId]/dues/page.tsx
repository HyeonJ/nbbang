import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getGroupForMember } from '@/lib/db/queries';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader } from '@/components/ui/page-header';

// 임시 자리표 — Plan 02 Task 8이 회차 목록·생성으로 교체한다.
// 탭에서 누르면 404가 뜨는 막다른 길을 막기 위한 최소 페이지(리뷰 지적).
export default async function DuesPlaceholderPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=/groups/${groupId}/dues`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader back={`/groups/${groupId}`} title="회비" />
      <GroupTabs groupId={groupId} isOwner={found.membership.role === 'owner'} />
      <p className="mt-7 border-t-2 border-ink py-6 text-[14px] text-muted">
        회비 회차와 납부 체크는 준비 중입니다.
      </p>
    </main>
  );
}
