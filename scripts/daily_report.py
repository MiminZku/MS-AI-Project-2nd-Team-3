#!/usr/bin/env python3
"""데일리 리포트(21:00 KST): 팀원별로 오늘의 커밋 diff + ai-log를 모아
docs/rules/report-format.md 형식대로 1인칭 리포트를 생성,
docs/daily-reports/YYYY-MM-DD/<이름>.md 로 저장한다.
(커밋은 워크플로 단계에서 수행)

필요 환경변수: ANTHROPIC_API_KEY, TEAMS_WEBHOOK_URL(선택)
"""
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
MODEL = os.environ.get("BRIEFING_MODEL", "claude-sonnet-4-6")
MAX_DIFF = 2500


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def parse_team():
    p = Path("docs/team.md")
    if not p.exists():
        return []
    members = []
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        name, gid, role = cells[0], cells[1], cells[2]
        if name in ("이름", "---") or set(gid) <= {"-", " "} or not gid:
            continue
        if gid.startswith("(") or "github아이디" in gid:
            continue
        members.append((name, gid, role))
    return members


def commits_for(gid, name, since_iso):
    """오늘 이 사람이 만든 커밋(전 브랜치)의 메시지+diff."""
    hashes = run(["git", "log", "--all", "--no-merges", f"--since={since_iso}",
                  "--pretty=format:%H|%an|%ae"]).splitlines()
    mine = []
    for line in hashes:
        if not line:
            continue
        h, an, ae = line.split("|", 2)
        blob = (an + " " + ae).lower()
        if gid.lower() in blob or name.lower() in blob:
            mine.append(h)
    if not mine:
        return ""
    parts = []
    for h in mine[:15]:
        msg = run(["git", "show", "-s", "--pretty=format:%s", h])
        diff = run(["git", "show", h, "--stat", "--patch", "--pretty=format:"])[:MAX_DIFF]
        parts.append(f"커밋: {msg}\n```\n{diff}\n```")
    return "\n\n".join(parts)


def ailog_for(gid, date_str):
    p = Path("docs/ai-log") / f"{gid}-{date_str}.md"
    return p.read_text(encoding="utf-8", errors="replace")[:3000] if p.exists() else ""


def call_claude(system, user):
    body = json.dumps({
        "model": MODEL, "max_tokens": 1200, "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body,
        headers={"Content-Type": "application/json",
                 "x-api-key": os.environ["ANTHROPIC_API_KEY"],
                 "anthropic-version": "2023-06-01"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode())
    return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()


def post_teams(title, body_text):
    url = os.environ.get("TEAMS_WEBHOOK_URL")
    if not url:
        return
    card = {"type": "message", "attachments": [{
        "contentType": "application/vnd.microsoft.card.adaptive",
        "content": {"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard", "version": "1.4", "msteams": {"width": "Full"},
                    "body": [{"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True},
                             {"type": "TextBlock", "text": body_text, "wrap": True}]}}]}
    req = urllib.request.Request(url, data=json.dumps(card).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read()


def main():
    members = parse_team()
    if not members:
        print("team.md 미기입 — 리포트 생성을 건너뜁니다.")
        return

    now = datetime.now(KST)
    date_str = f"{now:%Y-%m-%d}"
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    since_iso = midnight.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    fmt = Path("docs/rules/report-format.md").read_text(encoding="utf-8")
    plan = Path("docs/plan.md").read_text(encoding="utf-8")[:2500] if Path("docs/plan.md").exists() else ""

    out_dir = Path("docs/daily-reports") / date_str
    done, skipped = [], []

    for name, gid, role in members:
        commits = commits_for(gid, name, since_iso)
        ailog = ailog_for(gid, date_str)
        if not commits and not ailog:
            skipped.append(name)
            continue

        system = (
            "너는 팀원의 데일리 리포트를 본인 대신 작성하는 보조다. "
            "아래 형식 파일의 '작성 지침'과 '리포트 형식'을 정확히 따른다. "
            "사실에 없는 내용은 절대 지어내지 않는다. 마크다운으로만 출력하고 다른 말은 붙이지 않는다.\n\n" + fmt
        )
        user = (
            f"날짜: {date_str} / 작성자: {name} / 담당 파트: {role}\n\n"
            f"## 6일 계획 (내일 할 일 판단용)\n{plan}\n\n"
            f"## 오늘 내 커밋과 변경 내용\n{commits or '(커밋 없음)'}\n\n"
            f"## 오늘 내 AI 세션 요약\n{ailog or '(없음)'}\n\n"
            "위 자료로 오늘의 데일리 리포트를 작성해라. '내일 할 일'은 오늘 진행 상황과 계획표를 근거로 현실적으로."
        )
        try:
            report = call_claude(system, user)
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{name}.md").write_text(report + "\n", encoding="utf-8")
            done.append(name)
            print(f"생성: {name}")
        except Exception as e:
            print(f"실패({name}): {e}", file=sys.stderr)

    repo = os.environ.get("GITHUB_REPOSITORY", "MiminZku/MS-AI-Project-2st-Team-3")
    branch = os.environ.get("GITHUB_REF_NAME", "main")
    report_url = f"https://github.com/{repo}/tree/{branch}/docs/daily-reports/{date_str}"

    lines = []
    if done:
        lines.append(f"✅ **생성 완료 ({len(done)}명)** — {', '.join(done)}")
    if skipped:
        lines.append(f"⏳ **기록 없음** — {', '.join(skipped)}")
        lines.append("_push(미완성 OK) 후 Actions에서 daily-report를 재실행하면 만들어집니다. 직접 작성도 좋아요._")
    lines.append(f"🔗 [오늘 리포트 보러 가기]({report_url})")
    post_teams(f"📝 {now:%m/%d} 데일리 리포트", "\n\n".join(lines))
    summary = f"완료 {len(done)}명 / 건너뜀 {len(skipped)}명"
    print(summary)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"리포트 생성 실패: {e}", file=sys.stderr)
        sys.exit(1)
