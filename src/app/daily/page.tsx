import { SettingsScreen } from "@/components/settings-screen";

// 매일 하는 입력 전용 화면. 구현은 settings-screen 과 공유하고 노출 탭만 다르다.
// 사이드바 최상위에 두는 이유: 이게 이 대시보드에서 가장 자주 하는 작업인데
// 이전에는 '설정' 안 7개 탭 중 하나로 묻혀 있었다(2026-08 사용성 리뷰).
export default function DailyPage() {
  return <SettingsScreen mode="daily" />;
}
