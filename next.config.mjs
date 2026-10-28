/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // 공구 DM 원장 사실(scripts/lib/dm-facts.md)을 문자열로 번들에 넣는다. PC 워커는 같은 파일을 fs 로 읽는다
    config.module.rules.push({ test: /dm-facts\.md$/, type: "asset/source" });
    return config;
  },
  async redirects() {
    return [
      // 밸런스랩 제품별 손익은 월별 요약 안의 보기로 옮겼다 (2026-10-28). 옛 주소·북마크를 살린다.
      // 쿼리(예: ?product=food)는 Next 가 그대로 붙여 넘긴다
      { source: "/brand/balancelab/pnl", destination: "/monthly?view=pnl", permanent: false },
    ];
  },
};

export default nextConfig;
