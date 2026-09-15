'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { createSettlement } from '@/actions/settlement';
import { previewSettlement } from '@/lib/domain/settlement-view';
import { formatAmount } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

type Member = { id: string; displayName: string };

/**
 * 서버가 낼 수 있는 코드 → 한국어. **한 벌로 두 채널을 덮는다.**
 *
 * `createSettlement`는 실패를 두 경로로 돌려준다(actions/settlement.ts 주석):
 * zod 입력 검증은 `validationErrors`(handleValidationErrorsShape가 `{ code }` 하나로 접는다),
 * 액션 본문의 ActionError는 `serverError`. 한쪽만 읽으면 중복 참여자·제목 누락 같은 입력
 * 오류가 **아무 문구도 없이** 조용히 실패한다 — 그래서 아래에서 둘을 함께 읽는다.
 */
const ERRORS: Record<string, string> = {
  NOT_MEMBER: '모임 멤버가 아닌 참여자가 있습니다.',
  NO_PARTICIPANTS: '참여자를 한 명 이상 선택하세요.',
  PAYER_NOT_PARTICIPANT: '선결제자는 참여자 중에서 선택하세요.',
  INVALID_AMOUNT: '총액은 1원 이상 1억 원 이하의 정수여야 합니다.',
  DUPLICATE_PARTICIPANT: '같은 참여자가 두 번 선택됐습니다.',
  TOO_MANY_PARTICIPANTS: '참여자는 100명까지 선택할 수 있습니다.',
  INVALID_TITLE: '제목을 1자 이상 50자 이하로 입력하세요.',
  INVALID_DATE: '날짜를 YYYY-MM-DD 형식으로 입력해 주세요.',
  INVALID_INPUT: '입력값을 확인해 주세요.',
  FORBIDDEN: '총무만 정산을 만들 수 있습니다.',
  UNAUTHENTICATED: '로그인이 필요합니다.',
};

/** 미리보기가 아직 계산할 수 없는 상태 — 오류가 아니라 '다음에 할 일'이라 문구가 다르다. */
const PREVIEW_HINTS: Record<string, string> = {
  INVALID_AMOUNT: '총액을 입력하면 1인 부담액을 계산합니다.',
  NO_PARTICIPANTS: '참여자를 한 명 이상 선택하세요.',
  PAYER_NOT_PARTICIPANT: '선결제자를 참여자 중에서 선택하세요.',
  DUPLICATE_PARTICIPANT: '같은 참여자가 두 번 선택됐습니다.',
};

/** 시안의 `.chk` — 사각형, 2px 잉크 괘선, 선택되면 오렌지 채움 + 흰 체크. radius 0. */
const BOX =
  'relative size-[20px] shrink-0 border-2 border-ink bg-paper ' +
  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent';
// 입력은 그린 사각형 위에 투명하게 겹친다. sr-only로 숨기면 클립 때문에 포인터 판정이
// 흔들려 E2E가 못 누른다 — 크기를 가진 채 opacity-0으로 두어 진짜 탭 타깃으로 남긴다.
const INPUT = 'peer absolute inset-0 size-full cursor-pointer opacity-0';

export default function SettleForm({
  groupId,
  members,
  selfMembershipId,
  today,
}: {
  groupId: string;
  members: Member[];
  selfMembershipId: string;
  today: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [total, setTotal] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  // 기본은 전원 참여 — 회식비 정산에서 가장 흔한 경우이고, 빼는 쪽이 넣는 쪽보다 적다.
  const [checked, setChecked] = useState<string[]>(() => members.map((m) => m.id));
  const [payerId, setPayerId] = useState(selfMembershipId);

  const { execute, isPending, result } = useAction(createSettlement, {
    onSuccess({ data }) {
      // 정산을 만든 이유는 "누가 누구에게 얼마"를 보는 것이다 — 목록이 아니라 결과로 보낸다.
      if (data) router.push(`/groups/${groupId}/settle/${data.settlementId}`);
    },
  });

  // 참여자 순서는 **명단 순서**여야 한다 — splitEvenly가 나머지 1원을 앞사람부터 붙이므로
  // 체크한 순서로 넘기면 같은 사람들로 같은 금액을 만들어도 누가 더 내는지가 달라진다.
  const participantIds = members.filter((m) => checked.includes(m.id)).map((m) => m.id);

  // 미리보기는 **서버와 같은 순수 도메인 함수**로 계산한다(신뢰 경계가 아니다):
  // 저장되는 값은 서버가 같은 입력으로 다시 계산한 결과이고, 여기 값은 화면 표시용일 뿐이다.
  // 그래서 클라이언트에서 이 함수를 부르는 것이 안전하고, 미리보기와 결과가 어긋날 수도 없다.
  const preview = previewSettlement(Number(total), participantIds, payerId);

  const code = result.serverError ?? result.validationErrors?.code;
  const errorMessage = code
    ? (ERRORS[code] ?? '정산 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.')
    : null;

  function toggle(id: string) {
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <form
      className="space-y-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (isPending) return;
        execute({
          groupId,
          title,
          total: Number(total),
          occurredOn,
          payerMembershipId: payerId,
          participantMembershipIds: participantIds,
        });
      }}
    >
      {/* 시안 SCREEN 3의 규칙 — 입력은 금액이 주인공이다. 총액만 한 줄을 통째로 쓰고 등폭 20px. */}
      <Field
        label="총액"
        hint="원 단위 정수 — 선결제자가 이미 낸 금액"
        data-testid="settle-total"
        className="num text-[20px]"
        type="number"
        inputMode="numeric"
        // 브라우저 기본 피드백용 — 진짜 규칙은 서버 zod(정수·1 이상·1억 이하)가 들고 있다.
        min={1}
        max={100000000}
        step={1}
        value={total}
        onChange={(e) => setTotal(e.target.value)}
        required
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <Field
          label="제목"
          placeholder="예: 3월 회식"
          data-testid="settle-title"
          type="text"
          maxLength={50}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <Field
          label="날짜"
          data-testid="settle-date"
          type="date"
          value={occurredOn}
          onChange={(e) => setOccurredOn(e.target.value)}
          required
        />
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        {/*
          라벨은 괘선 **위**에 둔다 — fieldset의 border-top에 legend를 얹으면 브라우저가
          라벨 폭만큼 괘선을 끊어 내서, 2px 블랙 괘선이 중간에 잘린 것처럼 보인다(실측 확인).
          다른 화면(회차·지출)의 "라벨 → 2px 괘선으로 시작하는 표"와 같은 모양으로 맞춘다.
        */}
        <fieldset>
          <legend className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
            참여자 {participantIds.length}명
          </legend>
          <ul className="mt-4 border-t-2 border-ink">
            {members.map((m) => (
              <li key={m.id} className="border-b border-hairline">
                <label className="flex cursor-pointer items-center gap-3 py-2.5 text-[14px]">
                  <span className="relative inline-flex size-[20px] shrink-0">
                    <input
                      type="checkbox"
                      className={INPUT}
                      data-testid="settle-participant"
                      value={m.id}
                      checked={checked.includes(m.id)}
                      onChange={() => toggle(m.id)}
                    />
                    <span
                      aria-hidden
                      className={`${BOX} pointer-events-none peer-checked:border-accent peer-checked:bg-accent after:absolute after:top-[0.5px] after:left-[4.5px] after:hidden after:h-[10px] after:w-[5px] after:rotate-45 after:border-r-2 after:border-b-2 after:border-paper after:content-[''] peer-checked:after:block`}
                    />
                  </span>
                  {m.displayName}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset>
          <legend className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
            선결제자
          </legend>
          <ul className="mt-4 border-t-2 border-ink">
            {members.map((m) => (
              <li key={m.id} className="border-b border-hairline">
                <label className="flex cursor-pointer items-center gap-3 py-2.5 text-[14px]">
                  <span className="relative inline-flex size-[20px] shrink-0">
                    <input
                      type="radio"
                      name="payer"
                      className={INPUT}
                      data-testid="settle-payer"
                      value={m.id}
                      checked={payerId === m.id}
                      onChange={() => setPayerId(m.id)}
                    />
                    <span
                      aria-hidden
                      /*
                        라디오만 원형이다 — radius 0은 우리가 그리는 면(카드·버튼·표)의 규칙이고,
                        선택 컨트롤의 모양은 "하나만 고른다 vs 여러 개 고른다"를 알리는 어포던스다.
                        사각형으로 통일했을 때 실측 결과 체크박스와 구별되지 않아 잘못 누를 여지가
                        컸다(브라우저 확인에서 발견). 색이 아니라 **모양**으로 갈라 둔다.
                      */
                      className={`${BOX} pointer-events-none rounded-full peer-checked:border-accent after:absolute after:inset-[3px] after:hidden after:rounded-full after:bg-accent after:content-[''] peer-checked:after:block`}
                    />
                  </span>
                  {m.displayName}
                  {m.id === selfMembershipId ? (
                    <span className="text-[12px] text-muted">나</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>

      <section className="border-2 border-ink p-4" data-testid="settle-preview">
        <h2 className="font-display text-[11px] font-bold tracking-[0.14em] text-muted uppercase">
          미리보기
        </h2>
        {preview.ok ? (
          // 390px에서 3분할하면 '3,333~3,334원'의 단위가 줄바꿈된다 — 모바일은 세로로 쌓는다
          // (direction.md: 컬럼 수를 줄이지 말고 행을 재구성).
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <Stat label="1인 부담">{preview.shareLabel}원</Stat>
            <Stat label="이체">{preview.transferCount}건</Stat>
            <Stat label="받을 금액">{formatAmount(preview.transferTotal)}원</Stat>
          </dl>
        ) : (
          <p className="mt-2.5 text-[13px] leading-[1.7] text-muted">
            {PREVIEW_HINTS[preview.code] ?? '입력값을 확인해 주세요.'}
          </p>
        )}
      </section>

      <Button data-testid="settle-submit" type="submit" disabled={isPending}>
        {isPending ? '만드는 중…' : '정산 만들기'}
      </Button>
      {errorMessage && (
        <p
          role="alert"
          data-testid="settle-error"
          className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]"
        >
          {errorMessage}
        </p>
      )}
    </form>
  );
}

/** 미리보기 한 칸 — 라벨 위, 수치 아래. 금액은 잉크다(정산은 들어온 돈이 아니다). */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-display text-[10px] font-bold tracking-[0.14em] text-muted uppercase">
        {label}
      </dt>
      <dd className="num mt-1 text-[15px]">{children}</dd>
    </div>
  );
}
