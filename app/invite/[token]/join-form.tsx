'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { joinByInvite } from '@/actions/membership';

export default function JoinForm({ token }: { token: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');

  const { execute, isPending, result } = useAction(joinByInvite, {
    onSuccess({ data }) {
      // already:true(이미 멤버)도 동일하게 모임 페이지로 이동
      if (data) router.push(`/groups/${data.groupId}`);
    },
    onError({ error }) {
      // 페이지 방문 후 세션이 만료된 경우 — 로그인으로 유도
      if (error.serverError === 'UNAUTHENTICATED') {
        router.push(`/login?next=/invite/${token}`);
      }
    },
  });

  const serverError = result.serverError;
  const errorMessage =
    serverError === 'INVALID_INVITE'
      ? '만료되었거나 잘못된 초대 링크입니다.'
      : serverError && serverError !== 'UNAUTHENTICATED'
        ? '합류에 실패했습니다. 잠시 후 다시 시도해 주세요.'
        : null;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        execute({ token, displayName });
      }}
    >
      <input
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        data-testid="join-display-name"
        type="text"
        placeholder="모임에서 쓸 내 이름"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={20}
        required
      />
      <button
        className="w-full rounded-md bg-gray-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        data-testid="join-submit"
        type="submit"
        disabled={isPending}
      >
        {isPending ? '합류 중…' : '합류하기'}
      </button>
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
    </form>
  );
}
