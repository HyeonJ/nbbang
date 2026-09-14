'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const rawNext = searchParams.get('next');
  const next =
    rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') && !rawNext.includes('\\')
      ? rawNext
      : '/groups';
  const isSignup = mode === 'signup';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = isSignup
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(
          isSignup
            ? '가입에 실패했습니다. 입력 내용을 확인해 주세요.'
            : '이메일 또는 비밀번호가 올바르지 않습니다.',
        );
        return;
      }
      router.push(next);
    } catch {
      setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  }

  // 모임 내 탭과 같은 문법 — 활성 표시는 오렌지 밑줄 + 글자색 두 가지로 준다.
  const tabClass = (on: boolean) =>
    `-mb-px border-b-[3px] py-3 text-[13.5px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
      on ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'
    }`;

  return (
    <main className="mx-auto max-w-3xl px-5 pb-20">
      <PageHeader
        title="엔빵"
        right={
          <span className="font-display text-[11px] font-medium tracking-[0.18em] text-muted uppercase">
            Group Dues Ledger
          </span>
        }
      />

      <div className="max-w-sm">
        <nav aria-label="로그인·가입 전환" className="flex gap-5 border-b border-hairline">
          <button
            type="button"
            className={tabClass(!isSignup)}
            aria-current={!isSignup ? 'page' : undefined}
            data-testid="auth-toggle-login"
            onClick={() => {
              setMode('login');
              setError(null);
            }}
          >
            로그인
          </button>
          <button
            type="button"
            className={tabClass(isSignup)}
            aria-current={isSignup ? 'page' : undefined}
            data-testid="auth-toggle"
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
          >
            가입
          </button>
        </nav>

        <form onSubmit={handleSubmit} className="mt-7 space-y-6">
          {isSignup && (
            <Field
              label="이름"
              data-testid="auth-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <Field
            label="이메일"
            data-testid="auth-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            label="비밀번호"
            hint="8자 이상"
            data-testid="auth-password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <Button className="w-full" data-testid="auth-submit" type="submit" disabled={pending}>
            {pending ? '처리 중…' : isSignup ? '가입하기' : '로그인'}
          </Button>
        </form>

        {error && (
          <p role="alert" className="mt-6 border-l-2 border-ink pl-3 text-[13px] leading-[1.7]">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
