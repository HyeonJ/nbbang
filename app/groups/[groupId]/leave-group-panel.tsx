'use client';

import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { leaveGroup } from '@/actions/membership';
import { Button } from '@/components/ui/button';

const ERRORS: Record<string, string> = {
  OWNER_CANNOT_LEAVE: '총무는 모임을 나갈 수 없습니다.',
  NOT_MEMBER: '이미 모임을 나갔습니다.',
};

/**
 * 멤버 본인의 나가기. 되돌릴 수 있는 동작이라(초대 링크로 다시 들어온다) 타이핑 확인 대신
 * `confirm` 한 번이다 — 되돌릴 수 없는 모임 삭제·탈퇴와 다른 무게.
 */
export default function LeaveGroupPanel({ groupId, groupName }: { groupId: string; groupName: string }) {
  const router = useRouter();
  const { execute, isPending, result } = useAction(leaveGroup, {
    onSuccess() {
      router.replace('/groups');
      router.refresh();
    },
    onError({ error }) {
      if (error.serverError === 'UNAUTHENTICATED') {
        router.push(`/login?next=/groups/${groupId}`);
        return;
      }
      // 다른 탭에서 이미 나갔거나 내보내졌다 — 이 화면은 더 이상 볼 수 없다.
      if (error.serverError === 'NOT_MEMBER') {
        router.replace('/groups');
        router.refresh();
      }
    },
  });
  const code = result.serverError;
  const errorMessage =
    code && code !== 'UNAUTHENTICATED' ? (ERRORS[code] ?? '나가기에 실패했습니다. 잠시 후 다시 시도해 주세요.') : null;

  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-[1.7]">
        나가면 이 모임의 장부를 더 볼 수 없습니다. 남긴 기록은 그대로이고, 이미 명단에 있던 회차의 미납도
        남습니다. 초대 링크로 다시 들어올 수 있습니다.
      </p>
      <Button
        variant="outline"
        type="button"
        data-testid="leave-group"
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          if (!window.confirm(`${groupName}에서 나갈까요?`)) return;
          execute({ groupId });
        }}
      >
        {isPending ? '나가는 중…' : '모임 나가기'}
      </Button>
      {errorMessage && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
