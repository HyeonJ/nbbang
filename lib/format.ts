const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 정수 원 → 천단위 구분 문자열. 음수는 U+2212(−)로 표기해 하이픈과 구분한다. */
export function formatAmount(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('ko-KR');
  return amount < 0 ? `−${abs}` : abs;
}

/** UTC 저장값을 KST 날짜(YYYY-MM-DD)로. 서버·클라이언트 어디서 불려도 같은 결과를 낸다. */
export function formatDateKst(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
