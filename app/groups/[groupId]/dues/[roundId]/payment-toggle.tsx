'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { markPaid, unmarkPaid } from '@/actions/dues';
import { Button } from '@/components/ui/button';

/** 서버가 돌려주는 도메인 코드 → 한국어. 여기 없는 코드는 원문을 노출하지 않고 일반 문구로 덮는다. */
const ERRORS: Record<string, string> = {
  FORBIDDEN: '총무만 납부를 체크할 수 있습니다.',
  ROUND_NOT_FOUND: '회차를 찾을 수 없습니다.',
  NOT_MEMBER: '모임 멤버가 아닙니다.',
  PAYMENT_NOT_FOUND: '납부 기록이 없습니다.',
};

type Props = {
  groupId: string;
  roundId: string;
  membershipId: string;
  displayName: string;
  paid: boolean;
};

/**
 * 납부 체크/취소 한 칸. 체크는 즉시, 취소는 확인 후 — 취소도 되돌릴 수 없는 쓰기고 원장에 흔적이 남는다.
 * 두 액션을 각각 쥐고 현재 상태에 맞는 쪽만 쓴다(성공하면 행이 다른 섹션으로 옮겨 앉으며 다시 마운트된다).
 */
export default function PaymentToggle({ groupId, roundId, membershipId, displayName, paid }: Props) {
  const router = useRouter();

  // 페이지를 띄운 뒤 세션이 만료된 경우 — 일반 실패 문구로 덮지 않고 로그인으로 보낸다(reverse-button과 같은 처리).
  const onError = ({ error }: { error: { serverError?: string } }) => {
    if (error.serverError === 'UNAUTHENTICATED') {
      router.push(`/login?next=/groups/${groupId}/dues/${roundId}`);
    }
  };

  const mark = useAction(markPaid, { onError });
  const unmark = useAction(unmarkPaid, { onError });

  const active = paid ? unmark : mark;
  const isPending = mark.isPending || unmark.isPending;

  const errorMessage =
    active.result.serverError && active.result.serverError !== 'UNAUTHENTICATED'
      ? (ERRORS[active.result.serverError] ?? '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      : active.result.validationErrors
        ? '멤버를 찾을 수 없습니다.'
        : null;

  return (
    <>
      <Button
        variant={paid ? 'outline' : 'solid'}
        size="sm"
        type="button"
        data-testid="payment-toggle"
        aria-label={`${displayName} 납부 ${paid ? '취소' : '체크'}`}
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          if (paid) {
            if (!window.confirm('납부를 취소할까요? 원장에는 취소 기록이 남습니다.')) return;
            unmark.execute({ groupId, roundId, membershipId });
            return;
          }
          mark.execute({ groupId, roundId, membershipId });
        }}
      >
        {isPending ? (paid ? '취소 중…' : '체크 중…') : paid ? '취소' : '체크'}
      </Button>
      {errorMessage && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {errorMessage}
        </p>
      )}
    </>
  );
}
