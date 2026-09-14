'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { createRound } from '@/actions/dues';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

/** 서버가 돌려주는 도메인 코드 → 한국어. 여기 없는 코드는 원문을 노출하지 않고 일반 문구로 덮는다. */
const ERRORS: Record<string, string> = {
  INVALID_PERIOD: '기간은 YYYY-MM 형식이어야 합니다.',
  ROUND_EXISTS: '이미 만든 회차입니다.',
  FORBIDDEN: '총무만 회차를 만들 수 있습니다.',
};

/** thisMonth는 서버(RSC)에서 KST로 계산해 넘긴다 — 클라이언트 시계로 만들면 하이드레이션이 어긋난다. */
export default function RoundForm({ groupId, thisMonth }: { groupId: string; thisMonth: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(thisMonth);
  const [amountPerPerson, setAmountPerPerson] = useState('');

  const { execute, isPending, result } = useAction(createRound, {
    onSuccess({ data }) {
      // 회차를 만든 이유는 납부 체크다 — 목록에 머무르지 않고 방금 만든 회차로 들어간다.
      if (data) router.push(`/groups/${groupId}/dues/${data.roundId}`);
    },
  });

  const errorMessage = result.serverError
    ? (ERRORS[result.serverError] ?? '회차 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    : result.validationErrors
      ? result.validationErrors.amountPerPerson
        ? '1인 금액은 1원 이상 1,000만 원 이하의 정수여야 합니다.'
        : '입력값을 확인해 주세요.'
      : null;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPending) return;
        execute({ groupId, period, amountPerPerson: Number(amountPerPerson) });
      }}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="기간"
          hint="월 단위 회차"
          data-testid="round-period"
          // month 입력은 정확히 'YYYY-MM'을 내보낸다 — parsePeriod가 기다리는 그 형식이다.
          // 그래도 서버가 다시 파싱한다: 입력 위젯은 신뢰 경계가 아니고, 이 문자열은 (모임, 기간) 유니크 키의 절반이다.
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          required
        />
        <Field
          label="1인 금액"
          hint="원 단위 정수"
          data-testid="round-amount"
          type="number"
          inputMode="numeric"
          // 브라우저 기본 피드백용 — 진짜 규칙은 서버 zod(정수·1 이상·1000만 이하)가 들고 있다.
          min={1}
          max={10000000}
          step={1}
          value={amountPerPerson}
          onChange={(e) => setAmountPerPerson(e.target.value)}
          required
        />
      </div>
      <Button data-testid="round-create" type="submit" disabled={isPending}>
        {isPending ? '만드는 중…' : '회차 만들기'}
      </Button>
      {errorMessage && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
