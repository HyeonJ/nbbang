'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { addToRound, removeFromRound } from '@/actions/dues';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
  FORBIDDEN: '총무만 명단을 고칠 수 있습니다.',
  ROUND_NOT_FOUND: '회차를 찾을 수 없습니다.',
  NOT_MEMBER: '모임의 활동 중인 멤버가 아닙니다.',
  NOT_IN_ROSTER: '이미 명단에 없습니다.',
  PAID_MEMBER: '납부한 사람은 뺄 수 없습니다. 납부를 먼저 취소하세요.',
};

type Props = { groupId: string; roundId: string; membershipId: string; displayName: string };
type RemoveProps = Props & { left: boolean };

/** 실패 코드 → 문구. 세션 만료는 문구 대신 로그인으로 보낸다(payment-toggle과 같은 처리). */
function messageOf(code: string | undefined): string | null {
  if (!code || code === 'UNAUTHENTICATED') return null;
  return ERRORS[code] ?? '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

function useLoginRedirect(groupId: string, roundId: string) {
  const router = useRouter();
  return ({ error }: { error: { serverError?: string } }) => {
    if (error.serverError === 'UNAUTHENTICATED') router.push(`/login?next=/groups/${groupId}/dues/${roundId}`);
  };
}

/**
 * 면제 — 이 회차의 의무에서 뺀다. 활동 중인 멤버는 명단에 다시 넣으면 되돌려진다.
 * 단, 모임을 나간 멤버는 다시 넣을 수 없다(addToRound가 NOT_MEMBER로 거절) — 확인창이 그 사실을 알린다.
 */
export function RosterRemoveButton({ groupId, roundId, membershipId, displayName, left }: RemoveProps) {
  const { execute, isPending, result } = useAction(removeFromRound, { onError: useLoginRedirect(groupId, roundId) });
  const message = messageOf(result.serverError);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="roster-remove"
        aria-label={`${displayName} 면제`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          const confirmText = left
            ? `${displayName}은(는) 모임을 나간 멤버라 명단에서 빼면 다시 넣을 수 없습니다. 이 회차 미납을 면제할까요?`
            : `${displayName}을(를) 이 회차 명단에서 뺄까요? 예상 금액이 줄어듭니다.`;
          if (!window.confirm(confirmText)) return;
          execute({ groupId, roundId, membershipId });
        }}
      >
        {isPending ? '빼는 중…' : '면제'}
      </Button>
      {message && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {message}
        </p>
      )}
    </>
  );
}

export function RosterAddButton({ groupId, roundId, membershipId, displayName }: Props) {
  const { execute, isPending, result } = useAction(addToRound, { onError: useLoginRedirect(groupId, roundId) });
  const message = messageOf(result.serverError);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="roster-add"
        aria-label={`${displayName} 명단에 추가`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          execute({ groupId, roundId, membershipId });
        }}
      >
        {isPending ? '추가 중…' : '추가'}
      </Button>
      {message && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {message}
        </p>
      )}
    </>
  );
}
