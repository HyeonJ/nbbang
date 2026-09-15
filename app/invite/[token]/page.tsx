import Link from 'next/link';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { groups } from '@/lib/db/schema';
import { PageHeader } from '@/components/ui/page-header';
import JoinForm from './join-form';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  /**
   * ⚠️ 이 라우트도 **인증이 없다** — 초대 링크를 가진 사람이면 누구나 여기까지 온다.
   * 그래서 `groups` 행을 통째로 읽지 않고 **이름 하나만** 고른다(`public-queries.ts`와 같은 규칙).
   * 예전에는 `db.query.groups.findFirst`로 행 전체를 읽고 `.name`만 렌더했다 — 지금은 새지
   * 않지만, 그 행에는 `publicToken`(장부 전체)과 `accountLabel`(총무 계좌)이 들어 있으므로
   * 누군가 `group`을 `JoinForm`에 넘기는 한 줄이면 아직 멤버도 아닌 사람에게 그것이 실려 나간다.
   * 읽지 않은 값은 흘릴 수 없다.
   */
  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.inviteToken, token))
    .limit(1);
  if (!group) {
    return (
      <main className="mx-auto max-w-3xl px-5 pb-20">
        <PageHeader title="엔빵" />
        <p className="py-10 text-[14px] leading-[1.85] text-muted">만료되었거나 잘못된 초대 링크입니다.</p>
      </main>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader
        title={group.name}
        right={
          <span className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">Invite</span>
        }
      />

      <div className="max-w-sm">
        <p className="py-7 text-[14px] leading-[1.85] text-muted">
          모임에 초대되었습니다. 합류하면 회비·지출 장부를 함께 보게 됩니다.
        </p>
        {session ? (
          <JoinForm token={token} />
        ) : (
          <Link
            href={`/login?next=/invite/${token}`}
            className="block bg-ink px-5 py-3 text-center text-[14px] font-bold tracking-[0.04em] text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            data-testid="join-login-link"
          >
            로그인하고 합류하기
          </Link>
        )}
      </div>
    </main>
  );
}
