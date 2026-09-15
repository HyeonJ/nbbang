'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * 정산 공유 문구 + 복사 버튼 (F4/F6 같은 패턴 — `dues/[roundId]/unpaid-notice.tsx`와 같은 규칙).
 *
 * 문구를 화면에 그대로 노출한다 — 클립보드 권한이 없거나 막힌 환경에서도 손으로 복사할 수 있어야 하고,
 * E2E도 클립보드 권한 없이 이 텍스트를 읽는다. 복사는 읽기 전용이므로 멤버에게도 열어 둔다.
 *
 * '복사됨' 표시는 복사한 문구 자체를 기억해 판정한다 — 정산은 스냅샷이라 문구가 바뀌지 않지만,
 * 같은 규칙을 두 화면에서 쓰는 편이 나중에 한쪽만 낡는 것보다 낫다.
 */
export default function ShareText({ text }: { text: string }) {
  const [copiedText, setCopiedText] = useState('');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch {
      // 클립보드 권한이 없으면 표시된 문구를 직접 복사하도록 둔다.
    }
  }

  return (
    <div>
      <p
        className="mt-2.5 bg-wash p-2.5 text-[13px] leading-[1.7] whitespace-pre-wrap"
        data-testid="settle-share-text"
      >
        {text}
      </p>
      <div className="mt-3">
        <Button variant="outline" size="sm" type="button" data-testid="settle-share-copy" onClick={copy}>
          {copiedText === text ? '복사됨' : '복사하기'}
        </Button>
      </div>
    </div>
  );
}
