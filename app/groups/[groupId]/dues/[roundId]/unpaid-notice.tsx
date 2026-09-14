'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * 미납 독촉 문구 + 복사 버튼 (F6).
 *
 * 문구 자체를 화면에 그대로 노출한다 — 클립보드 권한이 없거나 막힌 환경에서도 손으로 복사할 수 있어야 하고,
 * E2E도 클립보드 권한 없이 이 텍스트를 읽는다. 복사는 읽기 전용 편의라 멤버에게도 열어 둔다
 * (문구는 보이는데 버튼만 없으면 고장처럼 보인다 — 서버 권한이 필요한 동작은 토글뿐이다).
 *
 * '복사됨' 표시는 복사한 문구 자체를 기억해 판정한다 — 그 사이 누군가 납부하면 문구가 바뀌고
 * 표시는 자동으로 '복사하기'로 돌아간다(낡은 성공 표시가 남지 않는다).
 */
export default function UnpaidNotice({ text }: { text: string }) {
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
        data-testid="unpaid-text"
      >
        {text}
      </p>
      <div className="mt-3">
        <Button variant="outline" size="sm" type="button" data-testid="unpaid-copy" onClick={copy}>
          {copiedText === text ? '복사됨' : '복사하기'}
        </Button>
      </div>
    </div>
  );
}
