import { describe, it, expect } from 'vitest';
import { formatAmount, formatDateKst } from '@/lib/format';

describe('formatAmount', () => {
  it('정수 원을 천단위 구분해 표기한다', () => {
    expect(formatAmount(360000)).toBe('360,000');
    expect(formatAmount(0)).toBe('0');
  });
  it('음수는 마이너스 기호(−)로 표기한다', () => {
    expect(formatAmount(-96000)).toBe('−96,000');
  });
});

describe('formatDateKst', () => {
  it('UTC 자정 직전도 KST 날짜로 변환한다', () => {
    // 2026-01-31T23:30:00Z = KST 2026-02-01 08:30
    expect(formatDateKst(new Date('2026-01-31T23:30:00Z'))).toBe('2026-02-01');
  });
  it('KST 자정 직후는 그날로 남는다', () => {
    // 2026-01-31T15:00:00Z = KST 2026-02-01 00:00
    expect(formatDateKst(new Date('2026-01-31T15:00:00Z'))).toBe('2026-02-01');
  });
});
