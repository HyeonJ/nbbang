import { describe, it, expect } from 'vitest';
import { authErrorMessage } from '@/lib/auth-errors';

describe('authErrorMessage', () => {
  it('429는 가입·로그인 어느 쪽이든 "잠시 후 다시" 안내로 보낸다', () => {
    const signup = authErrorMessage({ status: 429, isSignup: true });
    const login = authErrorMessage({ status: 429, isSignup: false });
    expect(signup).toBe('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    expect(login).toBe(signup);
  });

  it('429를 자격증명 오류로 뭉개지 않는다 — 이게 이 함수가 막는 실제 버그다', () => {
    expect(authErrorMessage({ status: 429, isSignup: false })).not.toContain('비밀번호');
    expect(authErrorMessage({ status: 429, isSignup: true })).not.toContain('입력 내용');
  });

  it('가입 실패는 입력 확인을 안내한다', () => {
    expect(authErrorMessage({ status: 400, isSignup: true })).toBe('가입에 실패했습니다. 입력 내용을 확인해 주세요.');
  });

  it('로그인 실패는 자격증명 오류를 안내한다', () => {
    expect(authErrorMessage({ status: 401, isSignup: false })).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
  });

  it('status가 없어도(네트워크 단절 등) 모드별 기본 문구를 낸다', () => {
    expect(authErrorMessage({ isSignup: true })).toBe('가입에 실패했습니다. 입력 내용을 확인해 주세요.');
    expect(authErrorMessage({ isSignup: false })).toBe('이메일 또는 비밀번호가 올바르지 않습니다.');
  });
});
