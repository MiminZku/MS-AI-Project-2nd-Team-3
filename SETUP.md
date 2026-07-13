# SETUP.md — 세팅 가이드 (약 15분)

이 키트는 6일 팀 프로젝트용 자동 동기화 시스템입니다.
- 매일 **09:00** Teams에 브리핑 2개 (어제 요약 / 오늘 할 일 + 방향 이탈 경고)
- 매일 **21:00** 팀원별 **데일리 리포트 자동 작성** + 기록 없는 팀원 알림(리마인더 겸용) → `docs/daily-reports/날짜/이름.md`로 커밋
- 팀원의 Claude Code / Codex가 세션 시작 시 프로젝트 컨텍스트를 자동으로 읽음
- "마감해줘" 한마디로 AI 세션 요약이 레포에 기록됨 (선택 사항)

---

## 1단계. 파일을 레포에 넣기 (2분)

이 압축을 푼 내용물 전체를 팀 레포 **루트**에 복사하고 커밋:

```
.github/workflows/   ← 자동화 2개 (아침 브리핑 / 밤 리포트)
scripts/             ← 브리핑/리마인더 스크립트
docs/                ← PROJECT, decisions, plan, team, rules, ai-log
CLAUDE.md            ← Claude Code 규칙
AGENTS.md            ← Codex 규칙
```

```bash
git add . && git commit -m "chore: 팀 동기화 시스템 추가" && git push
```

## 2단계. Teams 웹훅 만들기 (5분)

최신 Teams는 "Incoming Webhook 커넥터"가 아니라 **Workflows**로 만듭니다:

1. 브리핑 받을 채널(하나면 충분) 이름 옆 `...` → **Workflows** 클릭
2. 템플릿 중 **"Post to a channel when a webhook request is received"** (웹훅 요청 수신 시 채널에 게시) 선택
3. 이름 아무거나 → 팀/채널 확인 → 만들기
4. 완료 화면에 나오는 **URL 복사** (한 번만 보여주니 바로 복사)

> 이 템플릿이 안 보이면 Workflows 앱에서 검색하세요. 조직 정책으로 막혀 있으면 IT팀 문의가 필요할 수 있습니다.

## 3단계. GitHub Secrets 등록 (3분)

레포 → **Settings → Secrets and variables → Actions → New repository secret** 에서 2개 등록:

| 이름 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com 에서 발급한 API 키 |
| `TEAMS_WEBHOOK_URL` | 2단계에서 복사한 URL |

> API 비용: 하루 2회 요약 기준 6일 총 1달러 미만. 팀에서 누구 키를 쓸지만 정하세요.
> 조직 레포라면 Secrets 등록 권한(관리자)이 있는지 확인.

## 4단계. 문서 채우기 (5분, 킥오프 때)

- `docs/PROJECT.md` — 만드는 것 / **만들지 않는 것** / 확정 기술 결정. 이게 방향 이탈 감지의 기준이 됩니다.
- `docs/team.md` — 이름과 **github_id를 정확히**. 리마인더·데일리 리포트가 이 표로 사람을 매칭합니다.
- `docs/plan.md` — 날짜만 실제 날짜로 바꾸고, 필요하면 Day별 목표 조정.
- `docs/rules/report-format.md` — **과정/팀에서 요구하는 데일리 리포트 양식이 있으면** 이 파일의 형식 부분을 그 양식으로 교체. 봇이 항목·순서·문체까지 그대로 따라 씁니다.

## 5단계. 작동 확인 (2분)

레포 → **Actions 탭 → morning-briefing → Run workflow** 버튼으로 수동 실행.
1~2분 안에 Teams 채널에 브리핑 2개가 뜨면 성공. (첫날은 커밋이 없어 내용이 빈약한 게 정상)

> 매일 아침 브리핑이 안 왔을 때도 이 버튼으로 재실행하면 됩니다. 실패 원인은 Actions 로그에서 확인.

---

## 팀원 안내 (킥오프 때 공지할 것)

1. **작업 시작 전 `git pull`** — 그래야 네 AI가 최신 결정사항을 알고 시작함
2. **AI는 되도록 프로젝트 폴더 안에서** — Claude Code(터미널/VS Code 확장/데스크톱 앱)나 Codex(IDE 확장)로. 그래야 컨텍스트 자동 로딩 + 마감 기능이 작동
3. **퇴근 전 push** — 미완성(WIP)이어도 브랜치에 올리기. 내일 브리핑의 재료가 됨. 19시에 안 올린 사람 리마인더가 감
4. **작업 끝날 때 "마감해줘"** (선택) — AI가 오늘 논의를 요약해서 팀에 공유함. 코드 안 짠 날일수록 가치 있음
5. **투명성 공지**: 커밋 내용과 마감 요약(ai-log)은 매일 브리핑에서 팀 전원에게 공유됩니다

## 자주 묻는 것

- **21시에 리포트가 "기록 없음"으로 건너뛰어졌어요** → 그날 커밋도 ai-log도 없으면 지어내지 않고 건너뜁니다. push나 마감을 한 뒤 Actions 탭 → daily-report → Run workflow로 재실행하면 생성돼요.
- **리포트를 레포가 아니라 다른 곳(노션, LMS 등)에 제출해야 해요** → 봇은 레포 `docs/daily-reports/`에 만들어두는 것까지 담당합니다. 아침에 자기 파일 열어서 복붙 제출 (내용 검토도 겸사겸사 — 내 이름으로 나가는 글이니 30초 훑어보는 걸 권장).
- **웹 claude.ai로만 얘기했는데 마감하고 싶어요** → 대화 끝에 "이 세션 5줄로 요약해줘" 하고, GitHub 웹사이트에서 `docs/ai-log/`에 `본인아이디-날짜.md`로 Add file (터미널 불필요, 30초)
- **브리핑 시간을 바꾸고 싶어요** → `.github/workflows/*.yml`의 cron 수정. **UTC 기준**이므로 한국시간 −9시간 (예: KST 08:00 → `0 23 * * *` 전날)
- **리포트 알림이 나를 기록 없음으로 잘못 잡아요** → 커밋 author가 team.md의 github_id와 달라서 그렇습니다. `git config user.name "본인github아이디"` 설정 권장
- **프로젝트 끝나면** → 워크플로 파일 2개 삭제 또는 Actions 탭에서 Disable
