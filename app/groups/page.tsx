import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { groups, memberships } from '@/lib/db/schema';
import NewGroupForm from './new-group-form';

export default async function GroupsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login?next=/groups');

  const myGroups = await db
    .select({
      groupId: groups.id,
      name: groups.name,
      role: memberships.role,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(groups, eq(memberships.groupId, groups.id))
    .where(eq(memberships.userId, session.user.id));

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">내 모임</h1>

      {myGroups.length === 0 ? (
        <p className="mb-8 text-sm text-gray-500">아직 참여 중인 모임이 없습니다. 아래에서 모임을 만들어 보세요.</p>
      ) : (
        <ul className="mb-8 space-y-2">
          {myGroups.map((g) => (
            <li key={g.groupId}>
              <Link
                href={`/groups/${g.groupId}`}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-gray-400"
                data-testid="group-list-item"
              >
                <span className="font-medium text-gray-900">{g.name}</span>
                <span className="text-sm text-gray-500">
                  {g.role === 'owner' ? '총무' : '멤버'} · {g.joinedAt.toISOString().slice(0, 10)} 합류
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-lg font-medium text-gray-900">모임 만들기</h2>
        <NewGroupForm />
      </section>
    </main>
  );
}
