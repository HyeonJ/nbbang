import Link from 'next/link';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { groups } from '@/lib/db/schema';
import JoinForm from './join-form';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const group = await db.query.groups.findFirst({ where: eq(groups.inviteToken, token) });
  if (!group) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">엔빵</h1>
          <p className="text-sm text-gray-600">만료되었거나 잘못된 초대 링크입니다.</p>
        </div>
      </main>
    );
  }

  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-gray-900">{group.name}</h1>
        <p className="mb-6 text-sm text-gray-500">모임에 초대되었습니다.</p>
        {session ? (
          <JoinForm token={token} />
        ) : (
          <Link
            href={`/login?next=/invite/${token}`}
            className="block w-full rounded-md bg-gray-900 py-2 text-center text-sm font-medium text-white"
            data-testid="join-login-link"
          >
            로그인하고 합류하기
          </Link>
        )}
      </div>
    </main>
  );
}
