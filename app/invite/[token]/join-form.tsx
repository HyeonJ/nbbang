'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { joinByInvite } from '@/actions/membership';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

const ERRORS: Record<string, string> = {
  INVALID_INVITE: '만료되었거나 잘못된 초대 링크입니다.',
  INVALID_NAME: '모임에서 쓸 내 이름을 입력해 주세요.',
  RESERVED_NAME: '이 이름은 쓸 수 없습니다. 다른 이름을 입력해 주세요.',
  REMOVED_FROM_GROUP: '이 모임에서 내보내져 링크로 다시 들어올 수 없습니다. 총무에게 문의해 주세요.',
};

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
    serverError && serverError !== 'UNAUTHENTICATED'
      ? (ERRORS[serverError] ?? '합류에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      : null;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        execute({ token, displayName });
      }}
    >
      <Field
        label="모임에서 쓸 내 이름"
        data-testid="join-display-name"
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={20}
        required
      />
      <Button className="w-full" data-testid="join-submit" type="submit" disabled={isPending}>
        {isPending ? '합류 중…' : '합류하기'}
      </Button>
      {errorMessage && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
