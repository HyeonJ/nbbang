'use client';

import { useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { createExpense } from '@/actions/ledger';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

/** today는 서버(RSC)에서 KST로 계산해 넘긴다 — 클라이언트 시계로 만들면 하이드레이션이 어긋난다. */
export default function ExpenseForm({ groupId, today }: { groupId: string; today: string }) {
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [category, setCategory] = useState('');
  const [memo, setMemo] = useState('');

  const { execute, isPending, result } = useAction(createExpense, {
    onSuccess() {
      setAmount('');
      setOccurredOn(today);
      setCategory('');
      setMemo('');
    },
  });

  const serverError = result.serverError;
  const validationErrors = result.validationErrors;

  // 서버 도메인 에러(코드) → 한국어. 그 외 코드는 원문 노출 없이 일반 문구로 덮는다.
  const errorMessage = serverError
    ? serverError === 'FORBIDDEN'
      ? '총무만 기록할 수 있습니다.'
      : serverError === 'INVALID_AMOUNT'
        ? '금액은 1원 이상의 정수여야 합니다.'
        : '기록에 실패했습니다. 잠시 후 다시 시도해 주세요.'
    : // zod 단계에서 걸린 입력(범위 초과 등)도 코드가 아닌 한국어로 돌려준다.
      validationErrors
      ? validationErrors.amount
        ? '금액은 1원 이상 1억 원 이하의 정수여야 합니다.'
        : validationErrors.occurredOn
          ? '날짜를 YYYY-MM-DD 형식으로 입력해 주세요.'
          : '입력값을 확인해 주세요.'
      : null;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPending) return;
        execute({
          groupId,
          amount: Number(amount),
          occurredOn,
          category: category || undefined,
          memo: memo || undefined,
        });
      }}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="금액"
          hint="원 단위 정수"
          data-testid="expense-amount-input"
          type="number"
          inputMode="numeric"
          // 브라우저 기본 피드백용 — 진짜 규칙은 서버 zod(정수·1 이상·1억 이하)가 들고 있다.
          min={1}
          max={100000000}
          step={1}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <Field
          label="날짜"
          data-testid="expense-date"
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
          required
        />
        <Field
          label="분류"
          placeholder="예: 대관료"
          data-testid="expense-category"
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          maxLength={20}
        />
        <Field
          label="메모"
          data-testid="expense-memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          maxLength={100}
        />
      </div>
      <Button data-testid="expense-submit" type="submit" disabled={isPending}>
        {isPending ? '기록 중…' : '지출 기록'}
      </Button>
      {errorMessage && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
