#!/usr/bin/env python3
"""아침 브리핑: 지난 24시간의 커밋(전 브랜치) + ai-log를 Claude API로 분석해
Teams에 메시지 2개(어제 요약 / 오늘 제안)를 보낸다.

필요 환경변수:
  ANTHROPIC_API_KEY  - Anthropic API 키
  TEAMS_WEBHOOK_URL  - Teams Workflows(Power Automate) 웹훅 URL
표준 라이브러리만 사용 (별도 설치 불필요).
"""
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
# 프로젝트 진행일 (이 날짜들 사이의 공백일·주말·공휴일을 브리핑이 자동으로 건너뜀)
PROJECT_DATES = ["2026-07-14", "2026-07-16", "2026-07-20",
                 "2026-07-21", "2026-07-22", "2026-07-23"]
MODEL = os.environ.get("BRIEFING_MODEL", "claude-sonnet-4-6")
MAX_DIFF_CHARS_PER_COMMIT = 3000
MAX_TOTAL_INPUT_CHARS = 60000


def run(cmd: list[str]) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip()


def read_doc(path: str, limit: int = 6000) -> str:
    p = Path(path)
    if not p.exists():
        return "(파일 없음)"
    return p.read_text(encoding="utf-8", errors="replace")[:limit]


def collect_commits(since_hours: int = 24) -> str:
    """모든 원격 브랜치에서 최근 커밋과 diff를 수집한다."""
    since = f"{since_hours} hours ago"
    hashes = run([
        "git", "log", "--all", "--no-merges", f"--since={since}",
        "--pretty=format:%H",
    ]).splitlines()
    hashes = [h for h in hashes if h][:60]

    if not hashes:
        return "(지난 24시간 동안 커밋 없음)"

    chunks = []
    for h in hashes:
        meta = run(["git", "show", "-s", "--pretty=format:%an | %ad | %s", "--date=format-local:%m-%d %H:%M", h])
        branches = run(["git", "branch", "-r", "--contains", h])
        branch_names = ", ".join(
            b.strip().replace("origin/", "") for b in branches.splitlines()[:3]
        ) or "?"
        diff = run(["git", "show", h, "--stat", "--patch", "--pretty=format:"])
        if len(diff) > MAX_DIFF_CHARS_PER_COMMIT:
            diff = diff[:MAX_DIFF_CHARS_PER_COMMIT] + "\n...(diff 생략)"
        chunks.append(f"### 커밋 {h[:8]} [{branch_names}]\n{meta}\n```\n{diff}\n```")

    out = "\n\n".join(chunks)
    if len(out) > MAX_TOTAL_INPUT_CHARS:
        out = out[:MAX_TOTAL_INPUT_CHARS] + "\n...(이후 커밋 생략)"
    return out


def collect_ai_logs(lookback_hours: int = 24) -> str:
    """브리핑 대상 기간의 ai-log 파일을 수집한다."""
    today = datetime.now(KST).date()
    days = lookback_hours // 24 + 1
    dates = {str(today - timedelta(days=i)) for i in range(days + 1)}
    log_dir = Path("docs/ai-log")
    if not log_dir.exists():
        return "(ai-log 없음)"
    parts = []
    for f in sorted(log_dir.glob("*.md")):
        if any(d in f.name for d in dates):
            parts.append(f"### {f.name}\n{f.read_text(encoding='utf-8', errors='replace')[:2500]}")
    return "\n\n".join(parts) if parts else "(어제 제출된 ai-log 없음)"


def call_claude(system: str, user: str) -> str:
    body = json.dumps({
        "model": MODEL,
        "max_tokens": 1500,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    return normalize_breaks(text)


def normalize_breaks(text: str) -> str:
    """모델이 줄바꿈을 실제 개행 대신 리터럴 '\\n'(역슬래시+n)으로 쓰는 경우를
    실제 개행으로 되돌린다. Teams Adaptive Card는 실제 개행만 줄바꿈으로 렌더한다."""
    return (
        text.replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .replace("\\r", "\n")
    )


def post_teams(title: str, body_text: str) -> None:
    card = {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.4",
                "msteams": {"width": "Full"},
                "body": [
                    {"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True},
                    {"type": "TextBlock", "text": body_text, "wrap": True},
                ],
            },
        }],
    }
    req = urllib.request.Request(
        os.environ["TEAMS_WEBHOOK_URL"],
        data=json.dumps(card).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()


COMMON_SYSTEM = (
    "너는 6일짜리 6인 RAG 팀 프로젝트의 PM 보조다. Microsoft Teams 채팅에 올라갈 브리핑을 쓴다. "
    "출력 규칙: Adaptive Card TextBlock에 표시되므로 마크다운은 **굵게**, - 불릿, 실제 줄바꿈만 사용. "
    "줄을 바꿀 때는 실제로 엔터를 눌러 개행하고, '\\n' 같은 문자를 글자로 쓰지 마라. 문단 사이는 빈 줄 하나로 구분한다. "
    "헤더(#), 표, 코드블록 금지. 한국어로, 간결하게, 사실에 근거해서만 쓴다. "
    "ai-log는 제출한 사람 것만 반영하고, 제출하지 않은 사람을 지적하거나 나무라지 않는다."
)


def main() -> None:
    today = datetime.now(KST)
    # 직전 프로젝트 날 0시(KST)부터 지금까지를 돌아본다 (멘토링일·공휴일·주말 공백 자동 보정)
    prev = [d for d in PROJECT_DATES if d < f"{today:%Y-%m-%d}"]
    if prev:
        start = datetime.strptime(prev[-1], "%Y-%m-%d").replace(tzinfo=KST)
        lookback = max(24, int((today - start).total_seconds() // 3600) + 1)
    else:
        lookback = 24
    commits = collect_commits(since_hours=lookback)
    ai_logs = collect_ai_logs(lookback)
    project = read_doc("docs/PROJECT.md")
    plan = read_doc("docs/plan.md")
    team = read_doc("docs/team.md")
    decisions = read_doc("docs/decisions.md", limit=3000)

    context = (
        f"오늘 날짜(KST): {today:%Y-%m-%d %A}\n\n"
        f"## PROJECT.md (헌법)\n{project}\n\n"
        f"## plan.md (6일 로드맵)\n{plan}\n\n"
        f"## team.md (역할)\n{team}\n\n"
        f"## decisions.md (결정 로그)\n{decisions}\n\n"
        f"## 지난 {lookback}시간 커밋 (전 브랜치)\n{commits}\n\n"
        f"## AI 세션 요약 (ai-log)\n{ai_logs}\n"
    )

    msg1 = call_claude(
        COMMON_SYSTEM,
        context + "\n---\n위 자료로 '어제 한 일 요약'을 작성해라.\n"
        "- 팀원별로 한 줄씩: 커밋 diff와 ai-log를 근거로 실제 진행 내용을 사람 말로 요약\n"
        "- 커밋 메시지가 부실하면 diff 내용에서 파악\n"
        "- 활동 흔적(커밋도 ai-log도)이 없는 팀원은 마지막에 '어제 기록 없음: 이름들' 한 줄로만 중립적으로 표시\n"
        "- 결정 로그에 어제 추가된 항목이 있으면 '새 결정' 섹션으로 표시\n"
        "- 12줄 이내",
    )

    msg2 = call_claude(
        COMMON_SYSTEM,
        context + "\n---\n위 자료로 '오늘 할 일 제안'을 작성해라.\n"
        "- plan.md 기준 오늘이 Day 몇인지 판단하고, 계획 대비 진행 상황(앞섬/맞음/지연)을 첫 줄에 명시\n"
        "- 팀원별로 오늘 권장 작업 1개씩 (team.md의 담당 파트와 어제 진행 상황 기반)\n"
        "- **이탈 경고**: 어제 커밋 중 PROJECT.md의 확정 결정이나 '만들지 않는 것'과 어긋나는 변경이 보이면 ⚠️로 지적하고 확인을 요청. 없으면 이 섹션 생략\n"
        "- 병목이나 리스크가 보이면 한 줄 경고\n"
        "- 14줄 이내",
    )

    post_teams(f"📋 어제 한 일 — {today:%m/%d} 브리핑 1/2", msg1)
    post_teams(f"🎯 오늘 할 일 — {today:%m/%d} 브리핑 2/2", msg2)
    print("브리핑 2건 전송 완료")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"브리핑 실패: {e}", file=sys.stderr)
        sys.exit(1)
