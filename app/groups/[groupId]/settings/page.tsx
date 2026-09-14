import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getGroupForMember, getGroupMembers } from '@/lib/db/queries';
import { formatDateKst } from '@/lib/format';
import { Cell, DataTable, Row } from '@/components/ui/data-table';
import { GroupTabs } from '@/components/ui/group-tabs';
import { PageHeader, RoleBadge } from '@/components/ui/page-header';
import InviteLinkPanel from './invite-link-panel';

export default async function GroupSettingsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=/groups/${groupId}/settings`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  // 설정은 총무 전용 — member의 URL 직접 접근도 404로 차단.
  // (regenerateInviteToken 액션은 서버에서 이미 FORBIDDEN이지만 페이지도 잠근다.)
  if (found.membership.role !== 'owner') notFound();

  const { group } = found;
  const members = await getGroupMembers(groupId);

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader back="/groups" title={group.name} right={<RoleBadge role="owner" />} />
      <GroupTabs groupId={groupId} isOwner />

      <section className="pt-7">
        <h2 className="font-display text-[12px] font-bold tracking-[0.14em] text-ink uppercase">
          멤버 {members.length}명
        </h2>
        <div className="mt-4">
          <DataTable>
            {members.map((m) => (
              <Row key={m.id} testId="member-row">
                <Cell>
                  <span className="font-bold">{m.displayName}</span>
                  {m.role === 'owner' ? <span className="text-[12px] text-muted"> · 총무</span> : null}
                </Cell>
                <Cell align="right">
                  <span className="num text-[13px] font-medium text-muted">{formatDateKst(m.joinedAt)}</span>
                </Cell>
              </Row>
            ))}
          </DataTable>
        </div>
      </section>

      <section className="pt-10">
        <h2 className="font-display text-[12px] font-bold tracking-[0.14em] text-ink uppercase">초대 링크</h2>
        <div className="mt-4 border-t-2 border-ink pt-5">
          <InviteLinkPanel groupId={groupId} initialToken={group.inviteToken} />
        </div>
      </section>
    </main>
  );
}
