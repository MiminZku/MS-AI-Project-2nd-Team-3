from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routers import game, admin
import uvicorn
from pathlib import Path

app = FastAPI(title="Game Sanction Pipeline Backend")

# CORS 설정: 프론트엔드/게임 클라이언트에서 접근할 수 있도록 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 라우터 등록
app.include_router(game.router)
app.include_router(admin.router)

# 백엔드와 같은 포트에서 게임 프론트엔드도 제공한다.
GAME_CLIENT_DIR = Path(__file__).resolve().parent.parent / "game_client"
app.mount("/", StaticFiles(directory=str(GAME_CLIENT_DIR), html=True), name="game-client")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)
