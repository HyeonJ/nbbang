'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { removeMember, restoreMember } from '@/actions/membership';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
  FORBIDDEN: '총무만 할 수 있습니다.',
  NOT_MEMBER: '이미 모임에 없는 멤버입니다.',
  NOT_REMOVED: '내보낸 멤버만 되살릴 수 있습니다.',
};

type Props = { groupId: string; membershipId: string; displayName: string };

/** 실패 코드 → 문구. 세션 만료는 문구 대신 로그인으로 보낸다(roster-actions와 같은 처리). */
function messageOf(code: string | undefined): string | null {
  if (!code || code === 'UNAUTHENTICATED') return null;
  return ERRORS[code] ?? '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

function useLoginRedirect(groupId: string) {
  const router = useRouter();
  return ({ error }: { error: { serverError?: string } }) => {
    if (error.serverError === 'UNAUTHENTICATED') router.push(`/login?next=/groups/${groupId}/settings`);
  };
}

/** 내보내기 — 기록은 남고 접근만 끊긴다. 되살릴 수 있으므로 confirm 한 번. */
export function RemoveMemberButton({ groupId, membershipId, displayName }: Props) {
  const { execute, isPending, result } = useAction(removeMember, { onError: useLoginRedirect(groupId) });
  const message = messageOf(result.serverError);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="remove-member"
        aria-label={`${displayName} 내보내기`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          if (!window.confirm(`${displayName}을(를) 내보낼까요? 기록은 남고, 초대 링크로는 다시 들어올 수 없습니다.`)) {
            return;
          }
          execute({ groupId, membershipId });
        }}
      >
        {isPending ? '내보내는 중…' : '내보내기'}
      </Button>
      {message && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {message}
        </p>
      )}
    </>
  );
}

export function RestoreMemberButton({ groupId, membershipId, displayName }: Props) {
  const { execute, isPending, result } = useAction(restoreMember, { onError: useLoginRedirect(groupId) });
  const message = messageOf(result.serverError);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="restore-member"
        aria-label={`${displayName} 되살리기`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          execute({ groupId, membershipId });
        }}
      >
        {isPending ? '되살리는 중…' : '되살리기'}
      </Button>
      {message && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {message}
        </p>
      )}
    </>
  );
}
