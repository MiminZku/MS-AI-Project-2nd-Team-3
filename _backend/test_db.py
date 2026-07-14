import os
import sys
from dotenv import load_dotenv

# pip install psycopg2-binary python-dotenv

# .env 파일 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path = os.path.join(current_dir, '.env')

if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)
else:
    # 부모 디렉토리 등에서도 탐색 시도
    load_dotenv()

database_url = os.getenv("DATABASE_URL")

if not database_url:
    print("❌ 에러: .env 파일에서 DATABASE_URL을 찾을 수 없습니다.")
    print("'_backend' 폴더 안에 '.env' 파일이 존재하고, DATABASE_URL이 설정되어 있는지 확인해 주세요.")
    print("예: DATABASE_URL=postgresql://postgres:비밀번호@172.16.30.143:5432/apple_game")
    sys.exit(1)

# 접속 정보 마스킹하여 출력
masked_url = database_url
if "@" in database_url:
    parts = database_url.split("@")
    credentials = parts[0].split("://")
    if len(credentials) > 1 and ":" in credentials[1]:
        user_pass = credentials[1].split(":")
        masked_url = f"{credentials[0]}://{user_pass[0]}:******@{parts[1]}"
        
print(f"🔄 DB 접속을 시도합니다... (Target: {masked_url})")

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("\n❌ 에러: 필수 패키지가 설치되어 있지 않습니다.")
    print("아래 명령어를 실행하여 필요한 패키지를 설치해 주세요:")
    print("  pip install psycopg2-binary python-dotenv")
    sys.exit(1)

try:
    # 데이터베이스 연결
    conn = psycopg2.connect(database_url)
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    # 조회할 테이블 목록
    tables = ['users', 'admins', 'reports', 'sanctions', 'appeals']
    
    print("\n==========================================")
    print("📊 데이터베이스 테이블 조회 결과")
    print("==========================================")
    
    for table in tables:
        print(f"\n🔹 테이블: {table}")
        print("-" * 40)
        try:
            cursor.execute(f"SELECT * FROM {table};")
            rows = cursor.fetchall()
            if not rows:
                print("   (데이터가 존재하지 않습니다.)")
            else:
                for row in rows:
                    # datetime 객체 직렬화 호환을 위해 문자열 변환 처리하여 가독성 좋게 출력
                    print(f"   {dict(row)}")
        except Exception as e:
            print(f"   ⚠️ 쿼리 실행 실패: {e}")
            conn.rollback() # 에러 발생 시 트랜잭션 롤백 후 다음 테이블 진행
            
    cursor.close()
    conn.close()
    print("\n==========================================")
    print("✅ 데이터베이스 연결 및 조회 테스트를 성공적으로 마쳤습니다!")
    print("==========================================")
    
except Exception as e:
    print(f"\n❌ 데이터베이스 연결 실패: {e}")
    sys.exit(1)
