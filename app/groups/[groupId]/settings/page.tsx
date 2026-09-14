import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getGroupForMember, getGroupMembers } from '@/lib/db/queries';
import { formatDateKst } from '@/lib/format';
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
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">모임 설정</h1>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-2 text-lg font-medium text-gray-900">모임 정보</h2>
        <p className="text-sm text-gray-700">{group.name}</p>
      </section>

      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-medium text-gray-900">멤버</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2 font-medium">이름</th>
              <th className="py-2 font-medium">역할</th>
              <th className="py-2 font-medium">합류일</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-gray-100 last:border-b-0" data-testid="member-row">
                <td className="py-2 text-gray-900">{m.displayName}</td>
                <td className="py-2 text-gray-700">{m.role === 'owner' ? '총무' : '멤버'}</td>
                <td className="py-2 text-gray-500">{formatDateKst(m.joinedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-medium text-gray-900">초대 링크</h2>
        <InviteLinkPanel groupId={groupId} initialToken={group.inviteToken} />
      </section>
    </main>
  );
}
