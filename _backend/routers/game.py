from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, Response, Header, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
import os
import urllib.parse
import json
from services.game_state import manager
from services.llm_logic import analyze_chat
from database import SessionLocal
from models import Report, Sanction, User
import re

router = APIRouter()

RECORDINGS_DIR = "recordings"
os.makedirs(RECORDINGS_DIR, exist_ok=True)

class ReportRequest(BaseModel):
    reporter_id: str
    target_user_id: str
    channel: str # 'text' or 'voice'
    content_text: str = ""
    content_path: str = ""

class LoginRequest(BaseModel):
    user_id: str

@router.post("/api/login")
async def handle_login(req: LoginRequest):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == req.user_id).first()
        if not user:
            user = User(id=req.user_id)
            db.add(user)
            db.commit()
            db.refresh(user)
            
        now = datetime.now(timezone.utc)
        if user.banned_until and user.banned_until > now:
            return {"status": "banned", "banned_until": user.banned_until.isoformat()}
            
        is_muted = False
        if user.muted_until and user.muted_until > now:
            is_muted = True
        
        return {"status": "ok", "user_id": user.id, "is_muted": is_muted}
    except Exception as e:
        print(f"Login Error: {e}")
        return Response(content="error", status_code=500)
    finally:
        db.close()

async def process_report_task(report_id: int, channel: str, target_user_id: str, content_text: str, content_path: str):
    if channel == "voice" and content_path:
        from services.stt_logic import transcribe_audio
        stt_text = await transcribe_audio(content_path)
        print(f"\n======================================")
        print(f"🎤 [STT 변환 완료] 대상: {target_user_id}")
        print(f"변환된 텍스트: {stt_text}")
        print(f"======================================\n")
        content_text = stt_text
        
        # 변환된 텍스트를 DB에 업데이트
        if content_text:
            db = SessionLocal()
            try:
                db_report = db.query(Report).filter(Report.id == report_id).first()
                if db_report:
                    db_report.content_text = content_text
                db.commit()
            except Exception as e:
                print(f"STT DB Update Error: {e}")
            finally:
                db.close()

    if content_text:
        result = await analyze_chat(content_text)
        
        print(f"\n======================================")
        print(f"🔥 [OpenAI 분석 완료 (백그라운드)] 대상: {target_user_id}")
        print(f"채팅 내용: {content_text}")
        print(f"판정 결과: {json.dumps(result, ensure_ascii=False, indent=2)}")
        print(f"======================================\n")
        
        final_level = int(result.get("final_level", 0))
        
        if final_level > 0:
            db = SessionLocal()
            try:
                # 과거 제재 내역 조회 (가중 처벌용 룰베이스)
                past_sanctions = db.query(Sanction).filter(Sanction.user_id == target_user_id).count()
                
                if past_sanctions == 0:
                    duration_days = 1
                elif past_sanctions == 1:
                    duration_days = 7
                else:
                    duration_days = 9999
                
                sanction = Sanction(
                    user_id=target_user_id,
                    type="KICK_AND_BAN",
                    duration_days=duration_days,
                    ai_result=json.dumps(result, ensure_ascii=False)
                )
                db.add(sanction)
                
                db_report = db.query(Report).filter(Report.id == report_id).first()
                if db_report:
                    db_report.status = "COMPLETED"
                    
                target_user = db.query(User).filter(User.id == target_user_id).first()
                if target_user:
                    now = datetime.now(timezone.utc)
                    target_user.banned_until = now + timedelta(days=duration_days)
                        
                db.commit()
            except Exception as e:
                print(f"Background DB Error: {e}")
            finally:
                db.close()

            # 실시간 소켓 강퇴
            await manager.broadcast({"type": "chat", "message": {"user": "시스템", "text": f"🚨 {target_user_id}님이 유해발언(Lv.{final_level})으로 제재되었습니다. ({past_sanctions+1}회차 누적, {duration_days}일 정지)", "time": "now"}})
            await manager.kick_user(target_user_id, f"욕설 감지 (Lv.{final_level}, {past_sanctions+1}회차 누적)")
        else:
            # 제재 대상이 아니거나, HITL 수동 검토가 필요한 케이스
            db = SessionLocal()
            try:
                db_report = db.query(Report).filter(Report.id == report_id).first()
                if db_report:
                    if final_level == -1 or result.get("confidence", 1.0) < 0.7 or result.get("needs_human_review", False):
                        db_report.status = "PENDING_HITL"
                        db.commit()
                        from routers.admin import notify_admins
                        await notify_admins("new_hitl", {
                            "report_id": report_id,
                            "reporter": db_report.reporter_id,
                            "target": target_user_id,
                            "text": content_text,
                            "reason": result.get("reason", "Low confidence or Filtered")
                        })
                    else:
                        db_report.status = "COMPLETED"
                        db.commit()
            except Exception as e:
                print(f"Background DB Error (HITL): {e}")
            finally:
                db.close()

@router.post("/api/report")
async def handle_report(req: ReportRequest, background_tasks: BackgroundTasks):
    print(f"\n🚨 [신고 접수] 신고자: {req.reporter_id}, 대상: {req.target_user_id}, 채널: {req.channel}")
    
    db = SessionLocal()
    try:
        # 안전장치: DB에 유저가 없을 경우 강제 생성 (외래키 에러 방지)
        for uid in [req.reporter_id, req.target_user_id]:
            user = db.query(User).filter(User.id == uid).first()
            if not user:
                new_user = User(id=uid)
                db.add(new_user)
        db.commit()

        new_report = Report(
            reporter_id=req.reporter_id,
            reported_id=req.target_user_id,
            content_type=req.channel,
            content_text=req.content_text,
            content_path=req.content_path
        )
        db.add(new_report)
        db.commit()
        db.refresh(new_report)
        report_id = new_report.id

        # OpenAI 검사 및 제재 로직을 백그라운드로 위임
        background_tasks.add_task(process_report_task, report_id, req.channel, req.target_user_id, req.content_text, req.content_path)
                
        return {"status": "ok", "report_id": report_id}
    except Exception as e:
        print(f"Report Error: {e}")
        return Response(content="error", status_code=500)
    finally:
        db.close()


@router.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    connected = await manager.connect(websocket)
    if not connected:
        return

    # 접속 시 히스토리 전송
    await websocket.send_json({"type": "history", "messages": manager.history})
    await websocket.send_json({"type": "presence", "count": len(manager.active_connections)})
    await manager.broadcast_presence()

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "identify":
                user = data.get("user")
                if user and isinstance(user, str) and user.strip():
                    username = user[:40]
                    manager.clients_info[websocket] = username
                    db = SessionLocal()
                    try:
                        db_user = db.query(User).filter(User.id == username).first()
                        if db_user and db_user.muted_until and db_user.muted_until > datetime.now(timezone.utc):
                            manager.muted_users.add(username)
                        elif username in manager.muted_users:
                            manager.muted_users.remove(username)
                    except Exception as e:
                        print(f"Identify check error: {e}")
                    finally:
                        db.close()
                    await manager.broadcast_opponent_info()
            
            elif msg_type == "chat":
                user = data.get("user")
                text = data.get("text")
                if manager.is_user_muted(user):
                    await websocket.send_json({"type": "system", "text": "채팅이 금지된 상태입니다."})
                    continue
                if isinstance(user, str) and isinstance(text, str):
                    text = text.strip()[:500]
                    if text:
                        msg = manager.add_chat_history(user[:40], text)
                        await manager.broadcast({"type": "chat", "message": msg})
                        # 향후 이 부분에서 AI(LLM) 기반 욕설 필터링 및 DB 저장을 수행할 수 있습니다.

            # WebRTC 시그널링 메시지 중계 (1:1 통신을 가정하여 나를 제외한 모두에게 전달)
            elif msg_type in ["webrtc_offer", "webrtc_answer", "webrtc_ice_candidate"]:
                for other_ws in manager.active_connections:
                    if other_ws != websocket:
                        await other_ws.send_json(data)

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast_presence()
        await manager.broadcast_opponent_info()

@router.post("/upload-voice")
async def upload_voice(request: Request, x_user: Optional[str] = Header("unknown")):
    try:
        user = urllib.parse.unquote(x_user)
    except Exception:
        user = "unknown"
    
    user = user[:40]
    safe_user = re.sub(r'[^a-zA-Z0-9_가-힣]', '_', user)
    if not safe_user:
        safe_user = "unknown"

    body = await request.body()
    if len(body) > 20 * 1024 * 1024:
        return Response(content="too large", status_code=413)
    if not body:
        return Response(content="empty", status_code=400)

    filepath = os.path.join(RECORDINGS_DIR, f"{safe_user}.webm")
    with open(filepath, "wb") as f:
        f.write(body)

    manager.latest_recording_by_user[user] = {"filepath": filepath, "time": "now"}
    return Response(content="ok", status_code=200)

@router.get("/report-audio")
async def report_audio(user: str = ""):
    user = user[:40]
    rec = manager.latest_recording_by_user.get(user)
    if not rec or not os.path.exists(rec["filepath"]):
        return Response(content="not found", status_code=404)
    
    return FileResponse(rec["filepath"], media_type="audio/webm")
