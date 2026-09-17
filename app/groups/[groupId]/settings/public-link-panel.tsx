'use client';

import { useEffect, useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { regeneratePublicToken } from '@/actions/group';
import { Button } from '@/components/ui/button';

/**
 * 공개 장부 링크 패널 — 총무 전용(설정 화면 자체가 총무 전용이다).
 *
 * 초대 링크 패널과 문구·구조가 거의 같지만 **합치지 않는다**: 두 링크의 위험이 다르고
 * (초대는 합류 화면, 공개는 장부 전체), 그래서 재발급 확인 문구와 안내가 서로 다른 말을 해야 한다.
 * 공통화하면 한쪽 문구를 고칠 때 다른 쪽이 조용히 따라가 버린다.
 */
export default function PublicLinkPanel({
  groupId,
  initialToken,
}: {
  groupId: string;
  initialToken: string;
}) {
  const [token, setToken] = useState(initialToken);
  // origin은 서버 렌더에서 알 수 없다 — 마운트 후 채운다(초대 패널과 같은 방식).
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const { execute, isPending, result } = useAction(regeneratePublicToken, {
    onSuccess({ data }) {
      if (data) {
        setToken(data.publicToken);
        setCopied(false);
      }
    },
  });

  const publicUrl = `${origin}/g/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
    } catch {
      // 클립보드 권한이 없으면 표시된 링크를 수동 복사하도록 둔다.
    }
  }

  function regenerate() {
    if (isPending) return;
    const ok = window.confirm('공개 링크를 재발급할까요? 기존 링크는 즉시 무효가 됩니다.');
    if (ok) execute({ groupId });
  }

  return (
    <div>
      <p
        className="num border-2 border-ink p-3 text-[13px] leading-[1.6] font-medium break-all"
        data-testid="public-link"
      >
        {publicUrl}
      </p>
      {/**
       * 노출 고지는 **버튼보다 위**에 둔다 (외부 리뷰 IMPORTANT 16).
       *
       * 아래에 두면 "복사하기 → 단톡방에 붙여넣기"가 끝난 뒤에야 읽힌다 — 링크는 이미 나갔고,
       * 고지는 사후 통보가 된다. 푸터의 처리방침 링크만으로도 약하다(그 화면까지 가야 읽는다).
       * 이 문장이 닿아야 하는 순간은 **링크를 복사하기 직전**이다.
       */}
      <p className="mt-3 text-[12.5px] leading-[1.75] text-ink" data-testid="public-link-notice">
        이 링크를 가진 사람은 <b className="font-bold">로그인 없이</b> 멤버 이름과 지출 내역, 회비 납부
        여부, 잔액을 전부 봅니다. 링크를 아는 것이 유일한 조건이므로, 공유한 범위가 곧 공개 범위입니다.
        재발급하면 기존 링크는 <b className="font-bold">즉시</b> 무효가 되고 그 주소로는 아무것도 보이지
        않습니다.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" data-testid="public-copy" type="button" onClick={copy}>
          {copied ? '복사됨' : '복사하기'}
        </Button>
        <Button
          variant="outline"
          data-testid="public-regenerate"
          type="button"
          onClick={regenerate}
          disabled={isPending}
        >
          {isPending ? '재발급 중…' : '재발급'}
        </Button>
      </div>
      {result.serverError && (
        <p role="alert" className="mt-4 border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          재발급에 실패했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
    </div>
  );
}
