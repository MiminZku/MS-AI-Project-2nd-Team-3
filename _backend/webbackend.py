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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
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


@app.get("/api/dashboard")
def get_dashboard():
    """HITL 대기 중인 신고 목록 + 대기 중인 이의 신청 목록을 함께 반환한다."""
    with get_db_cursor() as cur:
        cur.execute(
            "SELECT * FROM reports WHERE status = 'MANUAL_REVIEW_REQUIRED' ORDER BY created_at ASC;"
        )
        hitl_reports = cur.fetchall()

        cur.execute(
            "SELECT * FROM appeals WHERE status = 'PENDING' ORDER BY created_at ASC;"
        )
        pending_appeals = cur.fetchall()

    return {"hitl_reports": hitl_reports, "pending_appeals": pending_appeals}


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

    try:
        response = httpx.post(
            f"{GAME_SERVER_URL}/admin/sanction-command",
            json=command.model_dump(),
            timeout=5.0,
        )
        response.raise_for_status()
        game_server_result = response.json()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"DB는 갱신했지만 게임 서버 반영 호출에 실패했습니다: {e}",
        )

    return {
        "report_id": command.report_id,
        "action": command.action,
        "game_server_response": game_server_result,
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
