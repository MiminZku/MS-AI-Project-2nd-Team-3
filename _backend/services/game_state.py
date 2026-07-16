from fastapi import WebSocket
from typing import List, Dict, Any
from datetime import datetime

class GameStateManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.clients_info: Dict[WebSocket, str] = {} # ws -> nickname
        self.history: List[Dict[str, Any]] = []
        self.latest_recording_by_user: Dict[str, Dict[str, Any]] = {} # user -> {"filepath": str, "time": timestamp}
        self.MAX_PLAYERS = 2
        self.MAX_HISTORY = 50

    async def connect(self, websocket: WebSocket) -> bool:
        await websocket.accept()
        if len(self.active_connections) >= self.MAX_PLAYERS:
            await websocket.send_json({"type": "full"})
            await websocket.close()
            return False
        
        self.active_connections.append(websocket)
        self.clients_info[websocket] = None
        return True

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if websocket in self.clients_info:
            del self.clients_info[websocket]

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

    async def broadcast_presence(self):
        await self.broadcast({"type": "presence", "count": len(self.active_connections)})

    async def broadcast_opponent_info(self):
        for ws in self.active_connections:
            opponent_name = None
            for other_ws, other_name in self.clients_info.items():
                if other_ws != ws and other_name is not None:
                    opponent_name = other_name
                    break
            await ws.send_json({"type": "opponent", "name": opponent_name})

    def add_chat_history(self, user: str, text: str):
        now = datetime.now()
        time_str = f"{now.hour:02d}:{now.minute:02d}"
        msg = {"user": user, "text": text, "time": time_str}
        self.history.append(msg)
        if len(self.history) > self.MAX_HISTORY:
            self.history.pop(0)
        return msg

manager = GameStateManager()
