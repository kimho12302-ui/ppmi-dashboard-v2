/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // 공구 DM 원장 사실(scripts/lib/dm-facts.md)을 문자열로 번들에 넣는다. PC 워커는 같은 파일을 fs 로 읽는다
    config.module.rules.push({ test: /dm-facts\.md$/, type: "asset/source" });
    return config;
  },
};

export default nextConfig;
