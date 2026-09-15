/**
 * 인증 API 실패를 사용자 문구로 옮긴다.
 *
 * 429를 따로 가려내는 이유가 이 함수의 존재 이유다. better-auth는 `/sign-in*`·`/sign-up*`에
 * IP당 10초 3회 제한을 기본으로 걸고, 넘치면 429를 준다. 이걸 "비밀번호가 틀렸다"로
 * 뭉개면 사용자는 멀쩡한 비밀번호를 의심하며 다시 누르고, 제한 창은 마지막 요청 기준으로
 * 다시 10초 밀리므로(rolling window) 누를수록 못 들어간다. 기다려야 한다는 사실을 말해줘야
 * 그 고리가 끊긴다.
 *
 * 초대 링크를 단체 대화방에 뿌리는 이 앱에선 같은 사무실·집 와이파이(같은 공인 IP)에서
 * 여러 명이 동시에 가입하는 게 정상 동선이라 실제로 밟히는 경로다.
 */
export function authErrorMessage({ status, isSignup }: { status?: number; isSignup: boolean }): string {
  if (status === 429) {
    return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (isSignup) {
    return '가입에 실패했습니다. 입력 내용을 확인해 주세요.';
  }
  return '이메일 또는 비밀번호가 올바르지 않습니다.';
}
