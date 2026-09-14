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

  const group = await db.query.groups.findFirst({ where: eq(groups.inviteToken, token) });
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
