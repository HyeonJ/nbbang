import type { NextConfig } from "next";

/**
 * 공개 장부(`/g/:token`)의 응답 헤더 — 이 라우트는 인증 없이 돈 기록을 내보내는 유일한 경로다.
 *
 * `Cache-Control: private, no-store`
 *   토큰을 재발급하면 옛 링크는 **즉시** 무효여야 한다. 페이지의 `dynamic = 'force-dynamic'`은
 *   Next의 렌더 캐시만 끄고, 그 앞의 CDN·브라우저·중간 프록시는 응답 헤더만 본다.
 *   `private`는 공유 캐시(CDN)에, `no-store`는 저장 자체에 걸린다 — 둘 다 필요하다.
 *
 * `Referrer-Policy: no-referrer`
 *   **이 헤더가 없으면 토큰이 샌다.** 하단 랜딩 링크를 누르는 순간 브라우저가
 *   `Referer: https://…/g/<publicToken>`을 붙여 보낸다. 같은 출처라 기본 정책
 *   (`strict-origin-when-cross-origin`)으로는 전체 경로가 그대로 실린다.
 *
 * `X-Robots-Tag: noindex, nofollow, noarchive`
 *   검색엔진이 링크를 주워 색인하면 "링크를 아는 사람만"이 무너진다. 페이지의
 *   `metadata.robots`(메타 태그)와 중복이지만 둘 다 둔다 — 크롤러가 HTML을 파싱하지 않고
 *   헤더만 보는 경로(HEAD 요청, 비HTML 응답)가 있기 때문이다.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/g/:token*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};

export default nextConfig;
