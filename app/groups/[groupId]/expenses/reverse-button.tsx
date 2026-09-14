'use client';

import { useAction } from 'next-safe-action/hooks';
import { reverseEntry } from '@/actions/ledger';
import { Button } from '@/components/ui/button';

/** 서버가 돌려주는 도메인 코드 → 한국어. 여기 없는 코드는 원문을 노출하지 않고 일반 문구로 덮는다. */
const ERRORS: Record<string, string> = {
  ALREADY_REVERSED: '이미 정정된 기록입니다.',
  NOT_REVERSIBLE: '정정 기록은 다시 정정할 수 없습니다.',
  ENTRY_NOT_FOUND: '기록을 찾을 수 없습니다.',
  FORBIDDEN: '총무만 정정할 수 있습니다.',
};

export default function ReverseButton({ groupId, entryId }: { groupId: string; entryId: string }) {
  const { execute, isPending, result } = useAction(reverseEntry);

  const errorMessage = result.serverError
    ? (ERRORS[result.serverError] ?? '정정에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    : result.validationErrors
      ? '기록을 찾을 수 없습니다.'
      : null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        type="button"
        data-testid="reverse-button"
        disabled={isPending}
        onClick={() => {
          if (isPending) return;
          // 되돌릴 수 없는 쓰기다 — 원장에 취소 기록이 남는다는 사실까지 알리고 확인받는다.
          if (!window.confirm('이 기록을 정정할까요? 원장에는 취소 기록이 남습니다.')) return;
          execute({ groupId, entryId });
        }}
      >
        {isPending ? '정정 중…' : '정정'}
      </Button>
      {errorMessage && (
        <p role="alert" className="mt-1.5 text-[12px] leading-[1.6]">
          {errorMessage}
        </p>
      )}
    </>
  );
}
