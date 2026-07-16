from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, Response, Header
from fastapi.responses import FileResponse
from typing import Optional
import os
import urllib.parse
from services.game_state import manager
import re

router = APIRouter()

RECORDINGS_DIR = "recordings"
os.makedirs(RECORDINGS_DIR, exist_ok=True)

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
                    manager.clients_info[websocket] = user[:40]
                    await manager.broadcast_opponent_info()
            
            elif msg_type == "chat":
                user = data.get("user")
                text = data.get("text")
                if isinstance(user, str) and isinstance(text, str):
                    text = text.strip()[:500]
                    if text:
                        msg = manager.add_chat_history(user[:40], text)
                        await manager.broadcast({"type": "chat", "message": msg})
                        # 향후 이 부분에서 AI(LLM) 기반 욕설 필터링 및 DB 저장을 수행할 수 있습니다.

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
