'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { deleteAccount } from '@/actions/account';
import { DELETE_ACCOUNT_CONFIRM } from '@/lib/domain/account';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

/**
 * 거부 코드 → 사람이 읽는 문구.
 *
 * `OWNS_GROUPS`의 문구가 이 화면에서 가장 중요한 한 줄이다. "탈퇴할 수 없습니다"만 쓰면
 * 사용자는 **자기가 뭘 잘못했는지** 찾게 된다 — 총무 위임은 정책상 금지가 아니라 아직
 * 만들지 않은 기능이기 때문이다(ADR-004). 이유와 다음 행동을 함께 적는다(리뷰 MINOR 23).
 */
const ERRORS: Record<string, string> = {
  OWNS_GROUPS:
    '총무로 있는 모임이 있어 탈퇴할 수 없습니다. 소유한 모임을 먼저 삭제해 주세요. ' +
    '총무를 다른 멤버에게 넘기는 기능은 아직 없습니다.',
  CONFIRM_MISMATCH: `확인 문구가 일치하지 않습니다. '${DELETE_ACCOUNT_CONFIRM}'을 그대로 입력하세요.`,
  ALREADY_DELETED: '이미 탈퇴한 계정입니다.',
  UNAUTHENTICATED: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
};

/**
 * 위험 구역 — 회원 탈퇴. 되돌릴 수 없다.
 *
 * 모임 삭제 패널(`settings/delete-group-panel.tsx`)과 같은 규칙을 따른다:
 *  · `window.confirm`이 아니라 **타이핑**이다 — 되돌릴 수 없는 동작은 한 번의 클릭으로
 *    끝나서는 안 된다.
 *  · 비교는 **양쪽 trim 후 정확 일치**이고 서버와 같은 규칙이다. 화면이 통과시킨 것을
 *    서버가 거절하면 사용자는 이유를 알 수 없는 실패를 본다.
 *  · 그럼에도 이 화면의 판정은 **연출이다** — 비활성 버튼은 서버 액션 POST를 막지 못한다
 *    (ADR-002). 진짜 판정은 `deleteAccount`가 잠근 행에서 한다.
 *
 * 모임 삭제와 다른 점 하나: 지울 대상이 **자기 자신**이라 이름을 옮겨 적게 할 것이 없다.
 * 그래서 고정 문구(`탈퇴합니다`)를 쓴다 — 대상을 지목하는 것이 아니라 의도를 확인하는 것이다.
 */
export default function DeleteAccountPanel({ ownedGroupNames }: { ownedGroupNames: string[] }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');

  const { execute, isPending, result } = useAction(deleteAccount, {
    onSuccess() {
      // 세션 행이 사라졌으므로 이 브라우저의 쿠키는 죽은 값이다. 홈으로 보내고 서버
      // 컴포넌트를 다시 그린다 — 남아 있던 화면이 탈퇴자의 이름을 계속 보여주지 않게.
      router.replace('/');
      router.refresh();
    },
  });

  const blocked = ownedGroupNames.length > 0;
  const matches = typed.trim() === DELETE_ACCOUNT_CONFIRM;
  const errorMessage = result.serverError
    ? (ERRORS[result.serverError] ?? '탈퇴에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    : null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPending || !matches || blocked) return;
        execute({ confirm: typed.trim() });
      }}
    >
      <p className="text-[13px] leading-[1.7]">
        이메일·표시 이름·비밀번호가 <b className="font-bold">즉시 파기됩니다.</b> 되돌릴 수 없습니다.
      </p>
      {/* 무엇이 **남는지** 숨기지 않는다 — ADR-004 결정 2. 처리방침(Task 4)과 같은 말을 쓴다. */}
      <p className="text-[12px] leading-[1.8] text-muted">
        참여했던 모임의 회비·지출·정산 기록은 <b className="font-bold text-ink">금액 그대로</b> 남고,
        이름만 &lsquo;탈퇴한 멤버&rsquo;로 바뀝니다. 남은 멤버들의 장부가 어긋나지 않게 하기 위해서입니다.
        원장 메모·정산 제목처럼 직접 입력하신 문구는 파기 대상이 아닙니다.
      </p>

      {blocked ? (
        <p
          role="alert"
          data-testid="delete-account-blocked"
          className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]"
        >
          총무로 있는 모임({ownedGroupNames.join(', ')})이 있어 탈퇴할 수 없습니다. 소유한 모임을 먼저
          삭제해 주세요. 총무를 다른 멤버에게 넘기는 기능은 아직 없습니다.
        </p>
      ) : (
        <Field
          label="확인 문구 입력"
          hint={
            <>
              확인을 위해 <b className="font-bold text-ink">{DELETE_ACCOUNT_CONFIRM}</b> 를 그대로 입력하세요.
            </>
          }
          data-testid="delete-account-confirm"
          autoComplete="off"
          maxLength={20}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      )}

      <Button data-testid="delete-account" type="submit" disabled={isPending || !matches || blocked}>
        {isPending ? '탈퇴 중…' : '회원 탈퇴'}
      </Button>
      {errorMessage && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
