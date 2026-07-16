from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import game, admin
import uvicorn

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

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=3000, reload=True)
