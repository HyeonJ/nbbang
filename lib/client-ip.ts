/**
 * 클라이언트 IP 파싱·정규화·해시 — 레이트 리밋 버킷 키의 **유일한 출처**.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  `x-forwarded-for` 신뢰 경계 — **실측 결과** (2026-09-17, Plan 04 Task 1 Step 1)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Plan 03은 서로 모순되는 두 기록을 남겼다: "로컬 `next start`에서 컨텍스트별 XFF 주입이
 * 먹혔다"(`e2e/helpers.ts`)와 "Next가 소켓 주소로 XFF를 채운다"(`lib/auth.ts`).
 * 둘을 임시 미들웨어로 실측해 보니 **둘 다 반쪽만 맞았다** — 규칙은 하나다:
 *
 *   **`next start`는 클라이언트가 XFF를 안 보냈을 때만 소켓 주소로 채운다.
 *     보냈으면 그 값을 한 글자도 바꾸지 않고 그대로 통과시킨다.**
 *
 *   | 로컬 `next start`로 보낸 것                      | 미들웨어가 읽은 값             |
 *   |---|---|
 *   | (XFF 없음)                                       | `::1`            ← 소켓에서 합성 |
 *   | `x-forwarded-for: 203.0.113.7`                   | `203.0.113.7`    ← 원본 보존    |
 *   | `x-forwarded-for: 203.0.113.7, 198.51.100.9`     | `203.0.113.7, 198.51.100.9` ← 체인 보존 |
 *   | `x-real-ip: 203.0.113.99` (XFF 없음)             | XFF=`::1`, x-real-ip=원본 보존   |
 *
 *   즉 **로컬에서는 XFF가 완전히 위조 가능**하다. 그래서 e2e의 컨텍스트별 XFF 주입은
 *   유효하고(제한을 끄는 우회가 아니라 배포 형태를 재현하는 것), 동시에 로컬 `next start`를
 *   인터넷에 직접 노출하면 이 레이트 리밋은 헤더 한 줄로 무력화된다.
 *
 * **프로덕션(Vercel)은 덮어쓴다 — 위조 불가.** 문서와 행동 양쪽으로 확인했다.
 *
 *   ① 문서(`vercel.com/docs/headers/request-headers`, `x-forwarded-for` 항목):
 *      "we currently **overwrite** the X-Forwarded-For header and **do not forward
 *       external IPs**. This restriction is in place to prevent IP spoofing."
 *      (클라이언트 XFF를 살리는 것은 Enterprise 전용 Trusted Proxy 옵션이다 — 이 프로젝트는 Hobby.)
 *
 *   ② 행동 측정 — 이미 배포돼 있던 better-auth 로그인 제한(`/sign-in/email`, 60초 8회)으로 쟀다.
 *      · 대조군: XFF 없이 12회 → 9번째부터 429 (제한이 실제로 도는 것을 확인)
 *      · 본 측정: **요청마다 다른** XFF(`203.0.113.1`…`203.0.113.20`)로 20회
 *        → **9번째부터 20번째까지 전부 429**, 직후 XFF 없는 요청도 429
 *      위조한 20개 값이 각자의 버킷을 만들지 못하고 **전부 한 버킷(내 실제 IP)** 으로 들어갔다.
 *      = Vercel이 클라이언트 XFF를 버리고 실제 IP로 덮어쓴다.
 *
 * **그래서 이 파일은 XFF를 직접 신뢰한다.** Vercel이 단일 값으로 덮어쓰므로 체인이 없고,
 * "첫 항목" / "마지막 항목" 선택은 프로덕션에서 같은 값을 가리킨다.
 *
 * `x-vercel-forwarded-for`를 **쓰지 않는 이유**: Vercel 문서는 그것이 `x-forwarded-for`와
 * 동일하다고만 적고, **클라이언트가 보낸 `x-vercel-forwarded-for`를 플랫폼이 제거하는지는
 * 명시하지 않는다.** 제거하지 않는다면 그 헤더를 읽는 순간 방금 닫은 우회가 다시 열린다.
 * 확인할 수 없는 헤더로 신뢰 범위를 넓히는 대신, **문서가 덮어쓴다고 명시하고 실측으로
 * 확인된 헤더 하나만** 읽는다.
 */

/**
 * 헤더 값 길이 상한. IPv6 최대 표기(45자) + 프록시 체인 몇 홉을 넉넉히 덮는다.
 * 이 상한이 있어야 500자 쓰레기가 파서를 지나 버킷 키 후보로 흘러가지 않는다.
 */
const MAX_HEADER_LENGTH = 256;

/**
 * 클라이언트 IP — 정규화된 문자열, 못 읽으면 `null`.
 *
 * ⚠️ `null`을 `'unknown'` 같은 상수로 뭉뚱그리지 **않는다.** 그러면 IP를 못 읽은 모든 요청이
 * 한 버킷에 들어가고, 한 사람이 그 버킷을 채워 나머지 전체를 잠근다. 호출자는 `null`을
 * **"제한하지 않는다"** 로 처리한다.
 *
 * ⚠️ XFF가 **있는데 파싱 실패**하면 `x-real-ip`로 떨어지지 않는다. 떨어지면
 * "쓰레기 XFF + 위조한 x-real-ip"라는 우회 경로가 생긴다. 프로덕션에서는 Vercel이 XFF를
 * 항상 유효한 값으로 채우므로 `x-real-ip` 분기는 도달하지 않는다 — 그 분기는 이 앱을
 * Vercel 밖(nginx 등 `x-real-ip`만 채우는 프록시)에 올릴 때를 위한 것이다.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    return normalizeIp(forwarded.split(',')[0]!.trim());
  }
  const real = headers.get('x-real-ip');
  if (real !== null) {
    return normalizeIp(real.trim());
  }
  return null;
}

/** 한 주소의 여러 표기를 하나로 모은다 — 표기만 바꿔 한도를 배로 쓰는 경로를 닫는다. */
function normalizeIp(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_HEADER_LENGTH) return null;
  return normalizeIpv4(raw) ?? normalizeIpv6(raw);
}

/**
 * 점 4개 10진 표기만 받는다.
 * 앞자리 0(`010.0.0.1`)을 거부하는 이유: 8진수로 읽는 구현이 세상에 있어 **한 주소에 두 표기**가
 * 생기고, 두 버킷으로 갈리면 한도가 두 배가 된다. 어차피 Vercel이 그런 값을 보내지 않는다.
 */
function normalizeIpv4(raw: string): string | null {
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    if (Number(part) > 255) return null;
  }
  return parts.join('.');
}

/**
 * IPv6을 16비트 그룹 8개로 파싱해 **RFC 5952 압축 표기**로 다시 쓴다.
 *
 * 느슨한 정규식 대신 실제 파서를 쓰는 이유는 정규화 때문이다 — `2001:DB8::1`과
 * `2001:0db8:0000:0000:0000:0000:0000:0001`은 같은 주소이므로 **같은 버킷**이어야 한다.
 *
 * 받지 않는 것: 대괄호(`[::1]`), 존 식별자(`%eth0`), `::` 둘 이상, 그룹 수 불일치.
 *
 * ⚠️ IPv4 매핑 주소는 RFC 5952 §5의 점 표기(`::ffff:192.0.2.1`)가 아니라 16진 표기
 * (`::ffff:c000:201`)로 정규화된다. 버킷에 필요한 것은 "같은 주소 → 같은 문자열"이라는
 * **일관성**이고 사람이 읽는 표기가 아니므로 의도한 선택이다.
 */
function normalizeIpv6(raw: string): string | null {
  if (!raw.includes(':')) return null;
  if (raw.includes('%') || raw.includes('[') || raw.includes(']')) return null;

  const halves = raw.split('::');
  if (halves.length > 2) return null;
  const compressed = halves.length === 2;

  const headText = halves[0]!;
  const tailText = compressed ? halves[1]! : '';
  const headParts = headText === '' ? [] : headText.split(':');
  const tailParts = tailText === '' ? [] : tailText.split(':');

  // IPv4 꼬리(`1:2:3:4:5:6:203.0.113.7`)는 주소 **맨 끝**에서만 허용된다.
  const head = parseGroups(headParts, !compressed);
  const tail = parseGroups(tailParts, true);
  if (head === null || tail === null) return null;

  const filled = head.length + tail.length;
  let groups: number[];
  if (compressed) {
    // `::`은 0 그룹을 **최소 한 개** 대신한다 — `1:2:3:4:5:6:7:8::`는 유효하지 않다.
    if (filled > 7) return null;
    groups = [...head, ...new Array<number>(8 - filled).fill(0), ...tail];
  } else {
    if (filled !== 8) return null;
    groups = head;
  }
  return formatIpv6(groups);
}

/** 그룹 문자열을 16비트 정수 배열로. `allowIpv4Tail`이면 마지막 항목이 점 표기일 수 있다. */
function parseGroups(parts: string[], allowIpv4Tail: boolean): number[] | null {
  const groups: number[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (allowIpv4Tail && i === parts.length - 1 && part.includes('.')) {
      const v4 = normalizeIpv4(part);
      if (v4 === null) return null;
      const [a, b, c, d] = v4.split('.').map(Number) as [number, number, number, number];
      groups.push((a << 8) | b, (c << 8) | d);
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

/** RFC 5952: 소문자, 선행 0 제거, **가장 긴** 0 구간(길이 2 이상)만 `::`로 압축, 동률이면 앞쪽. */
function formatIpv6(groups: number[]): string {
  const hex = groups.map((g) => g.toString(16));
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  let runLength = 0;
  for (let i = 0; i < groups.length; i += 1) {
    if (groups[i] === 0) {
      if (runStart < 0) {
        runStart = i;
        runLength = 1;
      } else {
        runLength += 1;
      }
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLength = 0;
    }
  }
  if (bestLength < 2) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

/**
 * 버킷 키용 IP 해시 — HMAC-SHA256의 **앞 32자(128비트)**.
 *
 * 엣지 런타임에는 Node의 `crypto.createHmac`이 없다 — **Web Crypto(`crypto.subtle`)** 를 쓴다.
 * (같은 코드가 Node 22의 단위·통합 테스트에서도 그대로 돈다. 전역 `crypto`가 양쪽에 다 있다.)
 *
 * 128비트로 자르는 이유: 버킷 키 길이를 고정하면서 충돌을 실질적으로 불가능하게 유지한다.
 * salt가 없으면 후보 IP를 넣어 대조할 수 없으므로 DB만 봐서는 IP를 복원할 수 없다.
 */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ip));
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * `RATE_LIMIT_SALT` — **기본값을 하드코딩하지 않는다**(글로벌 규칙).
 *
 * 기본값을 두면 모든 배포가 같은 salt를 쓰게 되고, 그 값이 코드에 있으므로 해시가
 * 평문 IP와 다를 바 없어진다. 없으면 던진다 — 호출자(`middleware.ts`)는 이 예외를
 * **잡지 않는다.** 설정 누락은 조용한 무제한이 아니라 큰 소리로 실패해야 한다.
 * (카운터 **쓰기** 실패는 반대로 fail-open이다 — `lib/rate-limit.ts` 참고. 설정 오류와
 *  런타임 장애를 일부러 다르게 다룬다.)
 */
export function rateLimitSalt(): string {
  const salt = process.env.RATE_LIMIT_SALT;
  if (!salt) {
    throw new Error(
      'RATE_LIMIT_SALT가 없습니다. 로컬은 .env.local/.env.test, CI는 GitHub Secrets, 배포는 Vercel 환경변수에 설정하세요.',
    );
  }
  return salt;
}
