'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const next = searchParams.get('next') ?? '/groups';
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold text-gray-900">엔빵</h1>
        <div className="mb-6 flex rounded-md border border-gray-200 p-1 text-sm">
          <button
            type="button"
            className={`flex-1 rounded py-1.5 ${!isSignup ? 'bg-gray-900 text-white' : 'text-gray-500'}`}
            data-testid="auth-toggle-login"
            onClick={() => { setMode('login'); setError(null); }}
          >
            로그인
          </button>
          <button
            type="button"
            className={`flex-1 rounded py-1.5 ${isSignup ? 'bg-gray-900 text-white' : 'text-gray-500'}`}
            data-testid="auth-toggle"
            onClick={() => { setMode('signup'); setError(null); }}
          >
            가입
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          {isSignup && (
            <input
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              data-testid="auth-name"
              type="text"
              placeholder="이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="auth-email"
            type="email"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            data-testid="auth-password"
            type="password"
            placeholder="비밀번호 (8자 이상)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <button
            className="w-full rounded-md bg-gray-900 py-2 text-sm font-medium text-white disabled:opacity-50"
            data-testid="auth-submit"
            type="submit"
            disabled={pending}
          >
            {pending ? '처리 중…' : isSignup ? '가입하기' : '로그인'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
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
