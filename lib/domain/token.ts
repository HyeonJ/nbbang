import { randomBytes } from 'node:crypto';

export function newToken(): string {
  return randomBytes(9).toString('base64url'); // 12 chars
}
