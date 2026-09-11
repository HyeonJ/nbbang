'use client';

import { useEffect, useState } from 'react';
import { useAction } from 'next-safe-action/hooks';
import { regenerateInviteToken } from '@/actions/group';

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
    <div className="space-y-3">
      <p
        className="break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
        data-testid="invite-link"
      >
        {inviteUrl}
      </p>
      <div className="flex gap-2">
        <button
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500"
          data-testid="invite-copy"
          type="button"
          onClick={copy}
        >
          {copied ? '복사됨' : '복사'}
        </button>
        <button
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:border-red-500 disabled:opacity-50"
          data-testid="invite-regenerate"
          type="button"
          onClick={regenerate}
          disabled={isPending}
        >
          {isPending ? '재발급 중…' : '재발급'}
        </button>
      </div>
      {result.serverError && (
        <p className="text-sm text-red-600">재발급에 실패했습니다. 잠시 후 다시 시도해 주세요.</p>
      )}
    </div>
  );
}
