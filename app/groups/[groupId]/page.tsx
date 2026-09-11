import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getGroupForMember, getGroupMembers } from '@/lib/db/queries';

export default async function GroupDashboardPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(`/login?next=/groups/${groupId}`);

  const found = await getGroupForMember(groupId, session.user.id);
  if (!found) notFound();

  const { group, membership } = found;
  const members = await getGroupMembers(groupId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900" data-testid="group-title">
          {group.name}
        </h1>
        {membership.role === 'owner' && (
          <Link
            href={`/groups/${groupId}/settings`}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500"
            data-testid="settings-link"
          >
            설정
          </Link>
        )}
      </div>

      <section className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="mb-1 text-sm text-gray-500">잔액</p>
          {/* Plan 02에서 원장(ledger_entries) 합산으로 교체 예정 — 잔액은 저장하지 않는 파생값 */}
          <p className="text-2xl font-semibold text-gray-900" data-testid="group-balance">
            0원
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <p className="mb-1 text-sm text-gray-500">멤버</p>
          <p className="text-2xl font-semibold text-gray-900">{members.length}명</p>
        </div>
      </section>

      <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <p className="text-sm text-gray-500">회비·지출·정산은 준비 중입니다.</p>
      </section>
    </main>
  );
}
