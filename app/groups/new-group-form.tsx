'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { createGroup } from '@/actions/group';

export default function NewGroupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');

  const { execute, isPending, result } = useAction(createGroup, {
    onSuccess({ data }) {
      if (data) router.push(`/groups/${data.groupId}`);
    },
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        execute({ name, displayName });
      }}
    >
      <input
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        data-testid="group-name"
        type="text"
        placeholder="모임 이름 (예: 배드민턴 동호회)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={50}
        required
      />
      <input
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        data-testid="group-display-name"
        type="text"
        placeholder="모임에서 쓸 내 이름"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={20}
        required
      />
      <button
        className="w-full rounded-md bg-gray-900 py-2 text-sm font-medium text-white disabled:opacity-50"
        data-testid="group-create"
        type="submit"
        disabled={isPending}
      >
        {isPending ? '만드는 중…' : '모임 만들기'}
      </button>
      {result.serverError && (
        <p className="text-sm text-red-600">모임 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.</p>
      )}
    </form>
  );
}
