import { describe, it, expect } from 'vitest';
import { newToken } from '@/lib/domain/token';

describe('newToken', () => {
  it('URL-safe 12+ chars, unique', () => {
    const a = newToken();
    const b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{12,}$/);
    expect(a).not.toBe(b);
  });
});
