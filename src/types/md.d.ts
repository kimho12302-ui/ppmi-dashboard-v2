// next.config.mjs 가 dm-facts.md 를 문자열로 묶어 넣는다(webpack asset/source). Vercel 함수에 파일이 안 따라가는 문제를 피한다
declare module "*.md" {
  const content: string;
  export default content;
}
