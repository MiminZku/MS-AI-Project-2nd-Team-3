from fastapi import APIRouter

router = APIRouter()

@router.get("/api/admin/reports")
async def get_reports():
    # TODO: PostgreSQL에서 저신뢰 케이스 등 리포트 목록 불러오기
    return {"message": "Admin reports list stub"}

@router.post("/api/admin/action")
async def admin_action(action_data: dict):
    # TODO: 관리자의 승인/해제 액션을 DB에 반영하고, game_state를 통해 게임 클라이언트에 알림
    return {"message": "Admin action applied stub"}
