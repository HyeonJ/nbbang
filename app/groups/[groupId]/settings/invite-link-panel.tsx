'use client';

import { useEffect, useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { regenerateInviteToken } from '@/actions/group';
import { Button } from '@/components/ui/button';

export default function InviteLinkPanel({ groupId, initialToken }: { groupId: string; initialToken: string }) {
  const [token, setToken] = useState(initialToken);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const { execute, isPending, result } = useAction(regenerateInviteToken, {
    onSuccess({ data }) {
      if (data) {
        setToken(data.inviteToken);
        setCopied(false);
      }
    },
  });

  const inviteUrl = `${origin}/invite/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      // 클립보드 권한이 없으면 표시된 링크를 수동 복사하도록 둔다.
    }
  }

  function regenerate() {
    if (isPending) return;
    const ok = window.confirm('초대 링크를 재발급할까요? 기존 링크는 즉시 무효화됩니다.');
    if (ok) execute({ groupId });
  }

  return (
    <div>
      <p className="num border-2 border-ink p-3 text-[13px] leading-[1.6] font-medium break-all" data-testid="invite-link">
        {inviteUrl}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="outline" data-testid="invite-copy" type="button" onClick={copy}>
          {copied ? '복사됨' : '복사하기'}
        </Button>
        <Button
          variant="outline"
          data-testid="invite-regenerate"
          type="button"
          onClick={regenerate}
          disabled={isPending}
        >
          {isPending ? '재발급 중…' : '재발급'}
        </Button>
      </div>
      <p className="mt-3 text-[12px] leading-[1.7] text-muted">
        재발급하면 기존 링크는 즉시 무효가 됩니다.
      </p>
      {result.serverError && (
        <p role="alert" className="mt-4 border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          재발급에 실패했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
    </div>
  );
}
