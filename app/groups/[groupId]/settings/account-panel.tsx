'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { updateGroupAccount } from '@/actions/group';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

const ERRORS: Record<string, string> = {
  FORBIDDEN: '총무만 계좌 문구를 바꿀 수 있습니다.',
};

/**
 * 입금 계좌 표시 문구 패널 — 총무 전용(설정 화면 자체가 총무 전용이다).
 *
 * 저장 성공 표시는 **저장한 문구 자체를 기억해** 판정한다 — 입력을 다시 고치면 '저장됨'이
 * 사라져 "지금 칸에 있는 값이 저장된 값"이라는 거짓말을 하지 않는다
 * (`unpaid-notice.tsx`·`share-text.tsx`의 복사 표시와 같은 규칙).
 *
 * 비우고 저장하면 서버가 `null`로 접는다 — 계좌 없음으로 되돌리는 방법이 이 한 가지뿐이어야
 * 하므로 별도의 '삭제' 버튼을 두지 않는다.
 */
export default function AccountPanel({
  groupId,
  initialAccountLabel,
}: {
  groupId: string;
  initialAccountLabel: string | null;
}) {
  const [value, setValue] = useState(initialAccountLabel ?? '');
  const [savedValue, setSavedValue] = useState<string | null>(null);

  const { execute, isPending, result } = useAction(updateGroupAccount, {
    onSuccess({ data }) {
      if (data) {
        // 서버가 trim·null 접기까지 끝낸 값을 그대로 화면에 되돌린다 — 칸과 저장값이 갈리지 않는다.
        setValue(data.accountLabel ?? '');
        setSavedValue(data.accountLabel ?? '');
      }
    },
  });

  const errorMessage = result.serverError
    ? (ERRORS[result.serverError] ?? '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    : result.validationErrors
      ? '계좌 문구는 60자까지 입력할 수 있습니다.'
      : null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPending) return;
        execute({ groupId, accountLabel: value });
      }}
    >
      <Field
        label="계좌 표시 문구"
        hint="미납 안내 문구에 함께 붙습니다. 공개 장부와 CSV에는 나오지 않습니다."
        data-testid="account-label"
        // 은행·번호·예금주를 한 줄로 받는다 — 형식 검증은 하지 않는다(은행마다 자릿수가 다르다).
        placeholder="카카오뱅크 3333-01-1234567 정현인"
        maxLength={60}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" data-testid="account-save" type="submit" disabled={isPending}>
          {isPending ? '저장 중…' : savedValue === value.trim() ? '저장됨' : '저장'}
        </Button>
        <span className="text-[12px] text-muted">비우고 저장하면 계좌 줄이 빠집니다.</span>
      </div>
      {errorMessage && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
