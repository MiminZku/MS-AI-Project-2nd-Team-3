import os
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Literal

import httpx
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

current_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(current_dir, ".env"))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ 에러: .env 파일에서 DATABASE_URL을 찾을 수 없습니다.")
    sys.exit(1)

# 게임 서버는 별도 프로세스/포트로 동작 (팀 확인: 완전 분리 구조)
GAME_SERVER_URL = os.getenv("GAME_SERVER_URL", "http://localhost:8000")
WEBBACKEND_PORT = int(os.getenv("WEBBACKEND_PORT", "8001"))

app = FastAPI(title="관리자 대시보드 웹 백엔드")

# 로컬 데모 전용 (배포 안 함): admin.html이 file://로도, 어떤 정적 서버 포트로도 열릴 수 있어 전체 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@contextmanager
def get_db_cursor():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


class SanctionCommand(BaseModel):
    report_id: int
    action: Literal["approve", "release"]
    reviewer_id: str


class AppealSubmission(BaseModel):
    report_id: int
    user_id: str
    reason: str


# AI 판단 엔진(gpt-5-mini)이 아직 연결되지 않아 PENDING 신고도 전량 관리자가 직접 심사한다.
# (엔진이 붙으면 이 상태 목록은 좁혀질 예정 — PROJECT.md 3번 섹션 참고)
QUEUE_STATUSES = ("PENDING", "MANUAL_REVIEW_REQUIRED")


def _notify_game_server(payload: dict) -> dict:
    """게임 서버에 실제 반영(뮤트/킥 등)을 요청한다. 게임 서버가 아직 없어도 관리자 판단/DB 반영은 막지 않는다."""
    try:
        response = httpx.post(
            f"{GAME_SERVER_URL}/admin/sanction-command", json=payload, timeout=5.0
        )
        response.raise_for_status()
        return {"ok": True, "data": response.json()}
    except httpx.HTTPError as e:
        return {"ok": False, "error": str(e)}


class SanctionCreate(BaseModel):
    sanction_type: Literal["warn", "mute_1d", "mute_7d", "ban_perm"]
    reason: str
    reviewer_id: str


class DismissCreate(BaseModel):
    reason: str
    reviewer_id: str


SANCTION_TYPE_MAP = {
    "warn": ("WARN", 0),
    "mute_1d": ("MUTE", 1),
    "mute_7d": ("MUTE", 7),
    "ban_perm": ("BAN", 0),  # duration_days=0을 영구정지 표식으로 사용 (ended_at도 NULL 유지)
}


@app.get("/api/dashboard")
def get_dashboard():
    """대기 중인 신고 큐(대상 유저의 중복 신고 수·과거 제재 이력 포함) + 대기 중인 이의 신청 목록을 반환한다."""
    with get_db_cursor() as cur:
        cur.execute(
            """
            SELECT r.*,
                COALESCE(dup.dup_count, 1) - 1 AS duplicate_count,
                COALESCE(prior.prior_count, 0) AS prior_offenses
            FROM reports r
            LEFT JOIN (
                SELECT reported_id, COUNT(*) AS dup_count
                FROM reports
                WHERE status = ANY(%(statuses)s)
                GROUP BY reported_id
            ) dup ON dup.reported_id = r.reported_id
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS prior_count
                FROM sanctions
                GROUP BY user_id
            ) prior ON prior.user_id = r.reported_id
            WHERE r.status = ANY(%(statuses)s)
            ORDER BY r.created_at ASC;
            """,
            {"statuses": list(QUEUE_STATUSES)},
        )
        queued_reports = cur.fetchall()

        cur.execute(
            "SELECT * FROM appeals WHERE status = 'PENDING' ORDER BY created_at ASC;"
        )
        pending_appeals = cur.fetchall()

    return {"hitl_reports": queued_reports, "pending_appeals": pending_appeals}


@app.get("/api/admin/reports")
def list_reports():
    """admin_dashboard.html의 '신고 내역' 탭용 — 상태와 무관하게 전체 신고 목록을 최신순으로 반환한다."""
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM reports ORDER BY created_at DESC;")
        return cur.fetchall()


@app.get("/api/admin/sanctions")
def list_sanctions():
    """admin_dashboard.html의 '제재 내역' 탭용 — 전체 제재 목록을 최신순으로 반환한다."""
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM sanctions ORDER BY created_at DESC;")
        return cur.fetchall()


@app.get("/api/admin/appeals")
def list_appeals():
    """admin_dashboard.html의 '이의 신청' 탭용 — 상태와 무관하게 전체 이의 신청 목록을 최신순으로 반환한다."""
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM appeals ORDER BY created_at DESC;")
        return cur.fetchall()


@app.post("/api/admin/reports/{report_id}/sanction")
def create_sanction(report_id: int, body: SanctionCreate):
    """관리자가 직접 고른 제재 수위를 적용한다 (AI 사전 판정이 아직 없는 현재 단계용)."""
    sanction_type, duration_days = SANCTION_TYPE_MAP[body.sanction_type]

    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM reports WHERE id = %s;", (report_id,))
        report = cur.fetchone()
        if not report:
            raise HTTPException(status_code=404, detail="해당 report_id의 신고 내역을 찾을 수 없습니다.")

        cur.execute(
            """
            INSERT INTO sanctions (user_id, ai_result, type, duration_days)
            VALUES (%s, %s, %s, %s) RETURNING *;
            """,
            (report["reported_id"], f"관리자 수동 판정: {body.reason}", sanction_type, duration_days),
        )
        sanction = cur.fetchone()

        cur.execute("UPDATE reports SET status = 'COMPLETED' WHERE id = %s;", (report_id,))

    game_server_sync = _notify_game_server(
        {
            "report_id": report_id,
            "user_id": report["reported_id"],
            "sanction_type": body.sanction_type,
            "reviewer_id": body.reviewer_id,
        }
    )

    return {"report_id": report_id, "sanction": sanction, "game_server_sync": game_server_sync}


@app.post("/api/admin/reports/{report_id}/dismiss")
def dismiss_report(report_id: int, body: DismissCreate):
    """신고를 오탐/근거 부족으로 취소 처리한다."""
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM reports WHERE id = %s;", (report_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="해당 report_id의 신고 내역을 찾을 수 없습니다.")

        cur.execute("UPDATE reports SET status = 'DISMISSED' WHERE id = %s;", (report_id,))

    return {"report_id": report_id, "status": "DISMISSED", "reason": body.reason, "reviewer_id": body.reviewer_id}


@app.post("/api/admin/sanction-command")
def send_sanction_command(command: SanctionCommand):
    """관리자가 승인(approve)/해제(release)를 누르면 DB를 갱신하고 게임 서버에 실제 반영을 요청한다."""
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM reports WHERE id = %s;", (command.report_id,))
        report = cur.fetchone()
        if not report:
            raise HTTPException(status_code=404, detail="해당 report_id의 신고 내역을 찾을 수 없습니다.")

        cur.execute(
            "UPDATE reports SET status = 'COMPLETED' WHERE id = %s;",
            (command.report_id,),
        )

        if command.action == "release":
            # sanctions는 report_id를 직접 참조하지 않으므로, 신고 대상 유저의
            # 아직 해제되지 않은 가장 최근 제재를 찾아 해제 처리한다.
            cur.execute(
                """
                UPDATE sanctions SET ended_at = %s
                WHERE id = (
                    SELECT id FROM sanctions
                    WHERE user_id = %s AND ended_at IS NULL
                    ORDER BY created_at DESC LIMIT 1
                )
                RETURNING id;
                """,
                (datetime.now(timezone.utc), report["reported_id"]),
            )

            cur.execute(
                "UPDATE appeals SET status = 'APPROVED' WHERE report_id = %s AND status = 'PENDING';",
                (command.report_id,),
            )

    game_server_sync = _notify_game_server(command.model_dump())

    return {
        "report_id": command.report_id,
        "action": command.action,
        "game_server_sync": game_server_sync,
    }


@app.post("/api/appeals")
def submit_appeal(appeal: AppealSubmission):
    """게임 클라이언트의 이의제기 폼에서 오탐 신고를 접수한다."""
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO appeals (report_id, user_id, reason) VALUES (%s, %s, %s) RETURNING *;",
            (appeal.report_id, appeal.user_id, appeal.reason),
        )
        created = cur.fetchone()

    return created


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("HOST", "0.0.0.0"), port=WEBBACKEND_PORT)
