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


def build_mail_content(category, level, sanction_type, duration_days, violation_count, reason):
    """제재 안내 우편 본문을 코드에서 조립한다. (AI 호출 없음, 기간은 매트릭스 확정값 사용)"""
    if sanction_type == "WARN":
        action = "경고 조치"
    elif sanction_type == "MUTE":
        action = f"채팅 제한 {duration_days}일 조치"
    elif duration_days >= 9999:
        action = "영구 이용제한 조치"
    else:
        action = f"게임 이용정지 {duration_days}일 조치"
    return (
        f"[제재 안내] 회원님의 채팅에서 '{category}' {level}단계에 해당하는 표현이 확인되어 "
        f"{action}가 적용되었습니다. (동일 유형 {violation_count}차 적발) "
        f"판정 근거: {reason} "
        f"이의가 있으실 경우 고객센터를 통해 이의를 제기하실 수 있습니다."
    )

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
    if channel == "voice":
        actual_path = None
        
        # 1. 피신고자의 음성 파일 업로드가 완료될 때까지 재시도 대기 (최대 5초, 0.5초 간격)
        for attempt in range(10):
            rec_info = manager.latest_recording_by_user.get(target_user_id)
            cand_path = rec_info.get("filepath") if rec_info else None
            
            if not cand_path or not os.path.exists(cand_path):
                safe_target = re.sub(r'[^a-zA-Z0-9_가-힣]', '_', target_user_id[:40]) if target_user_id else "unknown"
                possible_paths = [
                    content_path.lstrip("/") if content_path else "",
                    os.path.join(RECORDINGS_DIR, f"{safe_target}.wav"),
                    os.path.join(RECORDINGS_DIR, f"{target_user_id}.wav"),
                    content_path
                ]
                for p in possible_paths:
                    if p and os.path.exists(p):
                        cand_path = p
                        break

            if cand_path and os.path.exists(cand_path) and os.path.getsize(cand_path) > 0:
                actual_path = cand_path
                break
                
            await asyncio.sleep(0.5)

        if actual_path and os.path.exists(actual_path):
            from services.stt_logic import transcribe_audio
            stt_text = await transcribe_audio(actual_path)
            
            if stt_text and stt_text.strip():
                print(f"\n======================================")
                print(f"✅ [STT 변환 성공] 대상: {target_user_id}")
                print(f"파일 경로: {actual_path}")
                print(f"변환 텍스트: {stt_text}")
                print(f"======================================\n")
                content_text = stt_text
            else:
                print(f"\n======================================")
                print(f"❌ [STT 변환 실패 / 결과 없음] 대상: {target_user_id}")
                print(f"파일 경로: {actual_path}")
                print(f"======================================\n")
                content_text = ""

            # 변환된 텍스트 및 정밀 경로를 DB에 업데이트
            db = SessionLocal()
            try:
                db_report = db.query(Report).filter(Report.id == report_id).first()
                if db_report:
                    db_report.content_text = content_text
                    db_report.content_path = actual_path
                    db.commit()
            except Exception as e:
                print(f"STT DB Update Error: {e}")
            finally:
                db.close()
        else:
            print(f"\n❌ [STT 실패] 신고된 음성 파일 업로드가 완료되지 않았거나 찾을 수 없습니다. (대상: {target_user_id})")

    if content_text:
        result = await analyze_chat(content_text)
        
        print(f"\n======================================")
        print(f"🔥 [OpenAI 분석 완료 (백그라운드)] 대상: {target_user_id}")
        print(f"채팅 내용: {content_text}")
        print(f"판정 결과: {json.dumps(result, ensure_ascii=False, indent=2)}")
        print(f"======================================\n")
        
        final_level = int(result.get("final_level", 0))
        
        if final_level > 0:
            is_hitl = final_level == -1 or result.get("confidence", 1.0) < 0.9 or result.get("needs_human_review", False)
            if not is_hitl:
                db = SessionLocal()
                try:
                    # 1. Primary Category 추출
                    category_levels = result.get("category_levels", {})
                    primary_category = None
                    for cat, lvl in category_levels.items():
                        if lvl == final_level:
                            primary_category = cat
                            break
                    
                    # 2. 동일 카테고리 과거 위반 누적 횟수 조회
                    past_sanctions = db.query(Sanction).filter(Sanction.user_id == target_user_id).all()
                    same_category_count = 0
                    for s in past_sanctions:
                        if s.ai_result:
                            try:
                                s_result = json.loads(s.ai_result)
                                if s_result.get("category_levels", {}).get(primary_category, 0) > 0:
                                    same_category_count += 1
                            except:
                                pass
                                
                    violation_count = same_category_count + 1  # 이번 위반 포함 누적 차수
                    
                    # 3. 매핑 행렬(Matrix) 기반 처벌 수위 결정
                    sanction_type = "BAN"
                    duration_days = 0
                    
                    if final_level == 1:
                        if violation_count == 1: sanction_type, duration_days = "WARN", 0
                        elif violation_count == 2: sanction_type, duration_days = "MUTE", 3
                        elif violation_count == 3: sanction_type, duration_days = "MUTE", 7
                        else: sanction_type, duration_days = "BAN", 7
                    elif final_level == 2:
                        if violation_count == 1: sanction_type, duration_days = "MUTE", 7
                        elif violation_count == 2: sanction_type, duration_days = "BAN", 14
                        elif violation_count == 3: sanction_type, duration_days = "BAN", 30
                        else: sanction_type, duration_days = "BAN", 90
                    elif final_level == 3:
                        if violation_count == 1: sanction_type, duration_days = "BAN", 30
                        elif violation_count == 2: sanction_type, duration_days = "BAN", 90
                        else: sanction_type, duration_days = "BAN", 9999
                    else: # final_level >= 4
                        sanction_type, duration_days = "BAN", 9999

                    mail_content = build_mail_content(
                        primary_category, final_level, sanction_type,
                        duration_days, violation_count, result.get("reason", "")
                    )
                    result["mail_content"] = mail_content   # ai_result에 저장돼 관리자 대시보드가 봄 + 계약 충족

                    # 4. 제재 정보 DB 반영
                    sanction = Sanction(
                        user_id=target_user_id,
                        type=sanction_type,
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
                        if sanction_type == "BAN":
                            target_user.banned_until = now + timedelta(days=duration_days)
                        elif sanction_type == "MUTE":
                            if target_user.muted_until and target_user.muted_until > now:
                                target_user.muted_until = target_user.muted_until + timedelta(days=duration_days)
                            else:
                                target_user.muted_until = now + timedelta(days=duration_days)
                            
                    db.commit()
                except Exception as e:
                    print(f"Background DB Error: {e}")
                finally:
                    db.close()

                # 5. 실시간 소켓 액션
                ai_reason = mail_content
                if sanction_type == "BAN":
                    await manager.broadcast({"type": "chat", "message": {"user": "시스템", "text": f"🚨 {target_user_id}님이 유해발언(Lv.{final_level})으로 제재되었습니다. ({primary_category} {violation_count}차 적발, {duration_days}일 게임 정지)", "time": "now"}})
                    await manager.ban_user(target_user_id, f"욕설 감지 (Lv.{final_level}, {primary_category} {violation_count}차 누적 적발)", ai_reason)
                elif sanction_type == "MUTE":
                    await manager.broadcast({"type": "chat", "message": {"user": "시스템", "text": f"⚠️ {target_user_id}님이 유해발언(Lv.{final_level})으로 제재되었습니다. ({primary_category} {violation_count}차 적발, {duration_days}일 채팅 금지)", "time": "now"}})
                    await manager.mute_user(target_user_id, f"욕설 감지 (Lv.{final_level}, {primary_category} {violation_count}차 누적 적발)", ai_reason)
                elif sanction_type == "WARN":
                    target_ws = None
                    for ws, name in manager.clients_info.items():
                        if name == target_user_id:
                            target_ws = ws
                            break
                    if target_ws:
                        try:
                            payload = {
                                "type": "system", 
                                "text": f"⚠️ 유해발언(Lv.{final_level})이 감지되어 1차 경고 조치되었습니다. 반복 시 채팅 금지 또는 게임 정지 처리됩니다."
                            }
                            if ai_reason:
                                payload["ai_reason"] = ai_reason
                            await target_ws.send_json(payload)
                        except:
                            pass
            else:
                # 유해 발언이지만 HITL 수동 검토가 필요한 케이스
                db = SessionLocal()
                try:
                    db_report = db.query(Report).filter(Report.id == report_id).first()
                    if db_report:
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
                except Exception as e:
                    print(f"Background DB Error (HITL): {e}")
                finally:
                    db.close()
        else:
            # 정상 발언(0단계)이거나 HITL 수동 검토가 필요한 케이스 (content filter 차단 등)
            db = SessionLocal()
            try:
                db_report = db.query(Report).filter(Report.id == report_id).first()
                if db_report:
                    if final_level == -1 or result.get("confidence", 1.0) < 0.9 or result.get("needs_human_review", False):
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
                # 클라이언트가 보낸 user 값은 위조할 수 있으므로 identify된 소켓 사용자만 사용한다.
                user = manager.clients_info.get(websocket)
                text = data.get("text")
                if not user or not isinstance(text, str):
                    continue

                # 메모리 상태가 오래됐거나 관리자 제재 직후인 경우를 대비해 DB 제재 상태를 재확인한다.
                db = SessionLocal()
                try:
                    db_user = db.query(User).filter(User.id == user).first()
                    is_muted_in_db = bool(
                        db_user
                        and db_user.muted_until
                        and db_user.muted_until > datetime.now(timezone.utc)
                    )
                finally:
                    db.close()

                if is_muted_in_db:
                    manager.muted_users.add(user)
                else:
                    manager.muted_users.discard(user)

                if manager.is_user_muted(user):
                    await websocket.send_json({"type": "system", "text": "채팅이 금지된 상태입니다."})
                    continue

                text = text.strip()[:500]
                if text:
                    msg = manager.add_chat_history(user[:40], text)
                    await manager.broadcast({"type": "chat", "message": msg})
                    # 향후 이 부분에서 AI(LLM) 기반 욕설 필터링 및 DB 저장을 수행할 수 있습니다.

            # WebRTC 시그널링, 게임 시작 및 음성 업로드 요청 메시지 중계 (1:1 통신을 가정하여 나를 제외한 모두에게 전달)
            elif msg_type in ["webrtc_offer", "webrtc_answer", "webrtc_ice_candidate", "webrtc_renegotiate", "game_start", "request_voice_upload"]:
                for other_ws in manager.active_connections:
                    if other_ws != websocket:
                        await other_ws.send_json(data)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket Error: {e}")
    finally:
        manager.disconnect(websocket)
        # manager.disconnect 에는 async 함수를 직접 호출하지 않지만, 브로드캐스트는 async입니다.
        try:
            await manager.broadcast_presence()
            await manager.broadcast_opponent_info()
        except Exception:
            pass

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

    # 중복 방지를 위한 날짜 및 시간 타임스탬프 (YYYYMMDD_HHMMSS)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{safe_user}.wav"
    filepath = os.path.join(RECORDINGS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(body)

    manager.latest_recording_by_user[user] = {"filepath": filepath, "time": timestamp}
    print(f"🎙️ [음성 업로드] 유저: {user}, 파일: {filename}")
    return Response(content="ok", status_code=200)

@router.get("/report-audio")
async def report_audio(user: str = ""):
    user = user[:40]
    safe_user = re.sub(r'[^a-zA-Z0-9_가-힣]', '_', user)
    rec = manager.latest_recording_by_user.get(user)
    filepath = rec["filepath"] if rec and os.path.exists(rec.get("filepath", "")) else None
    
    if not filepath:
        possible_paths = [
            os.path.join(RECORDINGS_DIR, f"{safe_user}.wav"),
            os.path.join(RECORDINGS_DIR, f"{user}.wav")
        ]
        for p in possible_paths:
            if os.path.exists(p):
                filepath = p
                break

    if not filepath or not os.path.exists(filepath):
        return Response(content="not found", status_code=404)
    
    return FileResponse(filepath, media_type="audio/wav")
