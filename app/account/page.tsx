import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { groups, memberships } from '@/lib/db/schema';
import { getActiveSession } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import DeleteAccountPanel from './delete-account-panel';

export const metadata = { title: '계정 설정' };

/**
 * 계정 설정 — 지금은 위험 구역(회원 탈퇴) 하나뿐이다.
 *
 * 모임 설정(`/groups/:id/settings`)과 같은 배치를 따른다: 되돌릴 수 없는 동작은 화면 맨
 * 아래 **위험 구역**에 모으고, 다른 설정과 섞지 않는다.
 *
 * 소유한 모임 **이름**을 함께 넘기는 이유: 거부 문구가 "모임이 있어서"라고만 말하면
 * 모임을 여럿 가진 사람은 어느 것을 정리해야 하는지 모른다(ADR-004: 총무 위임은 미구현이라
 * 이 화면이 유일한 안내다). 이름은 이 사람이 총무인 모임이므로 새로 알려주는 정보가 아니다.
 */
export default async function AccountPage() {
  const session = await getActiveSession();
  if (!session) redirect('/login?next=/account');

  const owned = await db
    .select({ name: groups.name })
    .from(memberships)
    .innerJoin(groups, eq(memberships.groupId, groups.id))
    .where(and(eq(memberships.userId, session.user.id), eq(memberships.role, 'owner')));

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader back="/groups" title="계정 설정" />

      <section className="pt-7">
        <h2 className="font-display text-[12px] font-bold tracking-[0.14em] text-ink uppercase">계정</h2>
        <div className="mt-4 border-t-2 border-ink pt-5">
          <dl className="space-y-3 text-[14px]">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[12px] text-muted">이름</dt>
              <dd className="font-bold" data-testid="account-name">
                {session.user.name}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[12px] text-muted">이메일</dt>
              <dd className="break-all" data-testid="account-email">
                {session.user.email}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* 위험 구역 — 되돌릴 수 없는 동작만 여기 모은다. 맨 아래에 둔다. */}
      <section className="pt-14">
        <h2 className="font-display text-[12px] font-bold tracking-[0.14em] text-ink uppercase">위험 구역</h2>
        <div className="mt-4 border-t-2 border-ink pt-5">
          <DeleteAccountPanel ownedGroupNames={owned.map((g) => g.name)} />
        </div>
      </section>
    </main>
  );
}
