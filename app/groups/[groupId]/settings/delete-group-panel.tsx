'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { deleteGroup } from '@/actions/group';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

const ERRORS: Record<string, string> = {
  FORBIDDEN: '총무만 모임을 삭제할 수 있습니다.',
  NAME_MISMATCH: '모임 이름이 일치하지 않습니다.',
  GROUP_NOT_FOUND: '이미 삭제된 모임입니다.',
};

/**
 * 위험 구역 — 모임 완전 삭제. 총무 전용(설정 화면 자체가 총무 전용이다).
 *
 * ── 왜 `window.confirm`이 아니라 타이핑인가 ─────────────────────────────────
 * 재발급 패널 둘은 `confirm`을 쓴다. 그쪽은 되돌릴 수 있는 쓰기(다시 발급하면 된다)이고
 * 이것은 되돌릴 수 없다. `confirm`은 **무엇을** 지우는지 묻지 않는 한 번의 클릭이라,
 * 모임을 여럿 가진 총무가 엉뚱한 탭에서 누르는 사고를 막지 못한다. 이름을 옮겨 적게 하면
 * 사용자가 대상 모임을 직접 지목하게 된다.
 *
 * ── 그래도 이 화면의 판정은 **연출이다** ────────────────────────────────────
 * 비활성 버튼은 서버 액션 POST를 막지 못한다(ADR-002). 진짜 판정은 `deleteGroup`이
 * 잠근 행에서 읽은 이름으로 다시 한다 — 여기의 비교는 사용자가 실수하지 않게 돕는 것뿐이다.
 * 비교 규칙(양쪽 trim)을 서버와 같게 둔 이유도 같다: 화면이 통과시킨 것을 서버가 거절하면
 * 사용자는 이유를 알 수 없는 실패를 본다.
 */
export default function DeleteGroupPanel({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState('');

  const { execute, isPending, result } = useAction(deleteGroup, {
    onSuccess() {
      // 이 모임의 화면은 이제 존재하지 않는다 — 목록으로 보내고 서버 컴포넌트를 다시 그린다.
      router.replace('/groups');
      router.refresh();
    },
  });

  const matches = typed.trim() === groupName.trim() && typed.trim() !== '';
  const errorMessage = result.serverError
    ? (ERRORS[result.serverError] ?? '삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    : null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPending || !matches) return;
        execute({ groupId, name: typed.trim() });
      }}
    >
      <p className="text-[13px] leading-[1.7]">
        회비·지출·정산·멤버 기록이 <b className="font-bold">전부 사라집니다.</b> 공개 장부 링크도
        즉시 무효가 됩니다. 되돌릴 수 없습니다.
      </p>
      <Field
        label="모임 이름 입력"
        hint={
          <>
            확인을 위해 <b className="font-bold text-ink">{groupName}</b> 을(를) 그대로 입력하세요.
          </>
        }
        data-testid="delete-group-confirm"
        autoComplete="off"
        maxLength={50}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
      />
      <Button data-testid="delete-group" type="submit" disabled={isPending || !matches}>
        {isPending ? '삭제 중…' : '모임 영구 삭제'}
      </Button>
      {errorMessage && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
