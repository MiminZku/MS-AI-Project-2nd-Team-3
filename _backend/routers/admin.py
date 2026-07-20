import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Literal

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio
import json

from services.game_state import manager  # 실시간 웹소켓 제어를 위한 manager 연동

router = APIRouter()

admin_queues = []

async def notify_admins(event_type: str, data: dict):
    message = {"type": event_type, "data": data}
    for q in admin_queues:
        await q.put(message)

@router.get("/api/admin/stream")
async def admin_stream(request: Request):
    q = asyncio.Queue()
    admin_queues.append(q)
    
    async def event_generator():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=1.0)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    continue
        finally:
            if q in admin_queues:
                admin_queues.remove(q)
            
    return StreamingResponse(event_generator(), media_type="text/event-stream")

current_dir = os.path.dirname(os.path.abspath(__file__))
# .env 파일은 _backend 디렉토리에 있으므로 상위 경로로 지정
env_path = os.path.join(current_dir, "..", ".env")
load_dotenv(env_path)

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ 에러: .env 파일에서 DATABASE_URL을 찾을 수 없습니다.")

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

QUEUE_STATUSES = ("PENDING", "MANUAL_REVIEW_REQUIRED", "PENDING_HITL")

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
    "ban_perm": ("BAN", 0),
}

@router.get("/api/dashboard")
def get_dashboard():
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

@router.get("/api/admin/reports")
def list_reports():
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM reports ORDER BY created_at DESC;")
        return cur.fetchall()

@router.get("/api/admin/sanctions")
def list_sanctions():
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM sanctions ORDER BY created_at DESC;")
        return cur.fetchall()

@router.get("/api/admin/appeals")
def list_appeals():
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM appeals ORDER BY created_at DESC;")
        return cur.fetchall()

@router.post("/api/admin/reports/{report_id}/sanction")
async def create_sanction(report_id: int, body: SanctionCreate):
    sanction_type, duration_days = SANCTION_TYPE_MAP[body.sanction_type]
    reported_id = None

    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM reports WHERE id = %s;", (report_id,))
        report = cur.fetchone()
        if not report:
            raise HTTPException(status_code=404, detail="해당 report_id의 신고 내역을 찾을 수 없습니다.")
        
        reported_id = report["reported_id"]

        cur.execute(
            """
            INSERT INTO sanctions (user_id, ai_result, type, duration_days)
            VALUES (%s, %s, %s, %s) RETURNING *;
            """,
            (reported_id, f"관리자 수동 판정: {body.reason}", sanction_type, duration_days),
        )
        sanction = cur.fetchone()
        cur.execute("UPDATE reports SET status = 'COMPLETED' WHERE id = %s;", (report_id,))
        
        if sanction_type == "BAN":
            if duration_days == 0:
                cur.execute("UPDATE users SET banned_until = '2099-12-31' WHERE id = %s;", (reported_id,))
            else:
                cur.execute("UPDATE users SET banned_until = NOW() + INTERVAL '%s days' WHERE id = %s;", (duration_days, reported_id))
        else:
            cur.execute("UPDATE users SET muted_until = NOW() + INTERVAL '%s days' WHERE id = %s;", (duration_days, reported_id))

    # 실시간 웹소켓 제재 반영 (모놀리식 서버 통합의 핵심)
    if sanction_type == "BAN":
        await manager.ban_user(reported_id, f"관리자 제재: {body.reason}")
    else:
        await manager.mute_user(reported_id, f"관리자 제재: {body.reason}")

    return {"report_id": report_id, "sanction": sanction, "game_server_sync": {"ok": True, "data": "Local memory updated"}}

@router.post("/api/admin/reports/{report_id}/dismiss")
def dismiss_report(report_id: int, body: DismissCreate):
    with get_db_cursor() as cur:
        cur.execute("SELECT id FROM reports WHERE id = %s;", (report_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="해당 report_id의 신고 내역을 찾을 수 없습니다.")

        cur.execute("UPDATE reports SET status = 'DISMISSED' WHERE id = %s;", (report_id,))

    return {"report_id": report_id, "status": "DISMISSED", "reason": body.reason, "reviewer_id": body.reviewer_id}

@router.post("/api/admin/sanction-command")
async def send_sanction_command(command: SanctionCommand):
    reported_id = None
    with get_db_cursor() as cur:
        cur.execute("SELECT * FROM reports WHERE id = %s;", (command.report_id,))
        report = cur.fetchone()
        if not report:
            raise HTTPException(status_code=404, detail="해당 report_id의 신고 내역을 찾을 수 없습니다.")
        
        reported_id = report["reported_id"]
        cur.execute(
            "UPDATE reports SET status = 'COMPLETED' WHERE id = %s;",
            (command.report_id,),
        )

        if command.action == "release":
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
                (datetime.now(timezone.utc), reported_id),
            )
            cur.execute(
                "UPDATE appeals SET status = 'APPROVED' WHERE report_id = %s AND status = 'PENDING';",
                (command.report_id,),
            )
            cur.execute("UPDATE users SET banned_until = NULL, muted_until = NULL WHERE id = %s;", (reported_id,))
            if reported_id in manager.muted_users:
                manager.muted_users.remove(reported_id)

    # 실시간 웹소켓 제재 반영 (모놀리식 서버 통합)
    if command.action == "approve":
        await manager.ban_user(reported_id, f"신고 승인 - 제재 조치됨")

    return {
        "report_id": command.report_id,
        "action": command.action,
        "game_server_sync": {"ok": True, "data": "Local memory state updated"},
    }

@router.post("/api/appeals")
def submit_appeal(appeal: AppealSubmission):
    with get_db_cursor() as cur:
        cur.execute(
            "INSERT INTO appeals (report_id, user_id, reason) VALUES (%s, %s, %s) RETURNING *;",
            (appeal.report_id, appeal.user_id, appeal.reason),
        )
        created = cur.fetchone()
    return created
