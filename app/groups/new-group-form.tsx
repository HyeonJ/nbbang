'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAction } from 'next-safe-action/hooks';
import { createGroup } from '@/actions/group';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

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
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        execute({ name, displayName });
      }}
    >
      <Field
        label="모임 이름"
        hint="예: 배드민턴 동호회"
        data-testid="group-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={50}
        required
      />
      <Field
        label="모임에서 쓸 내 이름"
        data-testid="group-display-name"
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={20}
        required
      />
      <Button className="w-full" data-testid="group-create" type="submit" disabled={isPending}>
        {isPending ? '만드는 중…' : '모임 만들기'}
      </Button>
      {result.serverError && (
        <p role="alert" className="border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
          모임 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
    </form>
  );
}
