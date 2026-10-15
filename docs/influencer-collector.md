# 공구 셀러 수집기

대시보드 「모집 → 공구 셀러 발굴」(`/influencers`) 의 수집 쪽. 2026-10-14 신설.

## 흐름

1. 팀원이 대시보드에서 해시태그를 큐에 넣는다 → 시트 「발굴_태그」 에 `대기` 로 들어간다
2. aside 가 켜진 PC 에서 수집기가 돈다: 해시태그 검색 화면 → 게시물(최대 18개) → 올린 사람 → 프로필
3. 점수를 매겨 시트 「인스타_공구후보」 에 넣는다. 시트 어디든 이미 있는 핸들은 프로필을 열지도 않는다
4. 팀원이 대시보드에서 `후보 / 컨택함 / 제외` 를 누른다 → 시트의 상태·검토자·검토일이 바뀐다

정본은 협찬 리스트 시트(`src/lib/influencer-schema.json` 의 sheetId)다. 대시보드는 DB 에 따로 저장하지 않는다.

## 왜 공식 API 가 아닌가

인스타 해시태그 API 는 게시물의 올린 사람을 주지 않는다. 첫 DM 도 API 로는 못 보낸다(상대가 먼저 보낸 뒤 24시간만).
그래서 로그인된 aside 브라우저로 화면을 읽는다. 읽기만 한다. 팔로우·좋아요·DM 은 하지 않는다.

## 실행

```bash
# 시트의 대기 태그 수집
node scripts/influencer-collector.mjs --account u1 --expect <수집 계정 핸들>

# 시험: 시트에 안 쓰고 결과를 파일로
node scripts/influencer-collector.mjs --account u1 --expect <핸들> --dry-run --tags "#영양제공구" --out dry.json
# 그 결과를 그대로 시트에
node scripts/influencer-collector.mjs --expect <핸들> --from-json dry.json
```

- `--expect`: 로그인된 인스타 계정이 이것과 다르면 멈춘다. 브랜드 계정으로 긁는 사고를 막는다
- 하루 새 후보 30명(`--max-new`, 2026-10-15 김호), 하루 열람 80페이지(`--max-pages 80`). 수집 계정은 balancelab_official(aside u0, 김호 결정). 태그 하나에 약 40페이지, 약 4분
- 상태·로그: `~/.ppmi-influencer-collector/` (`state.json`, `collector.log`)
- 서비스계정 키: `~/.naver-searchad/google-service-account.json`

## 작업 스케줄러 (하루 한 번)

`.cmd` 로 감싸지 않는다(한글이 깨진다). node 를 직접 부른다. `aside update` 는 부르지 않는다.

```powershell
$a = New-ScheduledTaskAction -Execute "node.exe" -Argument "scripts\influencer-collector.mjs --account u1 --expect <수집 계정 핸들>" -WorkingDirectory "C:\Users\harry\projects\ppmi-dashboard-v2"
$t = New-ScheduledTaskTrigger -Daily -At 10:30
Register-ScheduledTask -TaskName "PPMI_InfluencerCollector" -Action $a -Trigger $t -Description "공구 셀러 수집 (aside). docs/influencer-collector.md"
```

끄기: `Disable-ScheduledTask PPMI_InfluencerCollector`

## 공구 제안 DM (2026-10-14)

1. 대시보드에서 후보를 「후보」로 고른다 → 시트 `DM 상태 = 초안 대기`
2. DM 워커가 그 계정의 소개글·최근 게시물 4개를 aside 로 읽고 `claude -p` 로 맞춤 초안을 쓴다.
   사실은 `scripts/lib/dm-facts.md`(원장에서 옮김)와 대시보드 「DM 제안 조건」의 「추가로 써도 되는 사실」만 쓴다. 참고 메시지는 김혜윤 실제 발송 양식(2026-10-14). 금지 표현이 나오면 한 번 다시 쓴다
3. 사람이 대시보드에서 고치고 「발송 승인」 → 워커가 다음 회차에 보낸다. 대시보드는 직접 보내지 않는다
4. 워커가 보낸 대화방을 다시 열어 상대 답장이 있으면 `DM 상태 = 회신`, 미리보기를 남긴다

```bash
node scripts/influencer-dm-worker.mjs --account u0 --expect balancelab_official
# 하는 일 고르기 --do draft,send,replies / 한 계정만 --only <핸들> / 하루 상한 --daily-cap 10
# 초안 미리보기(시트에 안 씀): --do draft --only <핸들> --preview
```

안전장치: 승인한 행만 · 승인 24시간 지나면 만료 · 하루 상한 10 · 한 회차 최대 3건, 건 사이 2~6분 ·
같은 사람에게는 **90일(3달) 텀**(시트 `DM 발송` + `~/.ppmi-influencer-collector/dm-state.json`, 지난 발송은 `DM 이력` 으로) · 대화방에 90일 안의 밸런스랩·공구 메시지가 있으면 안 보냄(손으로 보낸 제안 포함. 날짜를 못 읽으면 보내지 않음) ·
로그인 계정이 `--expect` 와 다르면 중단. 로그 `~/.ppmi-influencer-collector/dm-worker.log`.

- 첫 DM 은 상대의 **메시지 요청함**에 들어간다(팔로우 관계가 없으면). 2026-10-14 테스트로 확인
- 대화방은 `ig.me/m/<핸들>` 로 연다. 팔로우하지 않는 계정의 프로필에는 메시지 버튼이 없다

작업 스케줄러 (업무시간 1시간마다):

```powershell
$a = New-ScheduledTaskAction -Execute "node.exe" -Argument "scripts\influencer-dm-worker.mjs --account u0 --expect balancelab_official" -WorkingDirectory "C:\Users\harry\projects\ppmi-dashboard-v2"
$t = New-ScheduledTaskTrigger -Once -At 09:00 -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours 9)
Register-ScheduledTask -TaskName "PPMI_InfluencerDM" -Action $a -Trigger $t -Description "공구 제안 DM 초안·승인건 발송·회신 확인 (aside). docs/influencer-collector.md"
```

## 점수 (0~100)

팔로워 25(3천~10만이 만점) + 공구 신호 35(소개글 공구 · 🔛/🔜 일정 · 인포크 등 판매 링크 · 하이라이트 공구 · 공구 게시물) + 건강·영양 관련 20(영양제·건강식품·미네랄·다이어트 등 20, 생활·육아·운동 10) + 여러 태그에서 발견 10 + 이메일·카카오 10.
소개글에 "공구 제안 안 받습니다" 류가 있으면 40점을 깎는다.
