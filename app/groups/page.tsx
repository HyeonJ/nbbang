import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { groups, memberships } from '@/lib/db/schema';
import { formatDateKst } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
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
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader
        back="/"
        title="내 모임"
        right={
          <span className="num text-[15px] text-ink">
            {myGroups.length}
            <span className="text-[12px] font-medium">개</span>
          </span>
        }
      />

      {myGroups.length === 0 ? (
        <p className="py-10 text-[14px] leading-[1.85] text-muted">
          아직 참여 중인 모임이 없습니다. 아래에서 모임을 만들어 보세요.
        </p>
      ) : (
        <ul className="border-t-2 border-ink">
          {myGroups.map((g) => (
            <li key={g.groupId} className="border-b border-hairline">
              <Link
                href={`/groups/${g.groupId}`}
                className="flex items-baseline justify-between gap-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                data-testid="group-list-item"
              >
                <span className="text-[15px] font-bold">{g.name}</span>
                <span className="text-[12px] whitespace-nowrap text-muted">
                  {g.role === 'owner' ? '총무' : '멤버'} · <span className="num font-medium">{formatDateKst(g.joinedAt)}</span> 합류
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-12 border-t-2 border-ink pt-7">
        {/* 구역 제목은 잉크, 입력 라벨은 muted — 바로 아래 Field 라벨과 같은 무게로 보이지 않게 한다. */}
        <h2 className="font-display text-[12px] font-bold tracking-[0.14em] text-ink uppercase">모임 만들기</h2>
        <div className="mt-5 max-w-sm">
          <NewGroupForm />
        </div>
      </section>
    </main>
  );
}
