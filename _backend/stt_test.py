import os
import sys
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# dotenv 파일 로드 (_backend/.env 및 프로젝트 루트 .env 탐색)
backend_dir = Path(__file__).resolve().parent
dotenv_path = backend_dir / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path)
else:
    load_dotenv()

# _backend 디렉터리를 sys.path에 추가하여 모듈 임포트 가능하도록 설정
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from services.stt_logic import transcribe_audio

async def main():
    print("=" * 60)
    print(" [Azure Speech SDK STT Test Script]")
    print("=" * 60)
    
    # 환경변수 검증
    speech_key = os.environ.get("AZURE_SPEECH_KEY")
    speech_region = os.environ.get("AZURE_SPEECH_REGION")
    
    print(f"AZURE_SPEECH_REGION: {speech_region if speech_region else 'MISSING'}")
    print(f"AZURE_SPEECH_KEY   : {'SET (Hidden)' if speech_key else 'MISSING'}")
    print("엔진 방식           : Azure Speech SDK (Profanity Raw Mode)")
    print("-" * 60)

    if not speech_key or not speech_region:
        print("[ERROR] AZURE_SPEECH_KEY 또는 AZURE_SPEECH_REGION 환경변수가 설정되지 않았습니다.")
        print(".env 파일을 확인하시고 키와 지역 정보를 설정해 주세요.")
        return

    # 테스트할 오디오 파일 경로 결정
    if len(sys.argv) > 1:
        audio_path = sys.argv[1]
    else:
        print("사용법: python stt_test.py <audio_file_path>")
        print("예시  : python stt_test.py recordings/sample.wav")
        print("-" * 60)
        print("[NOTICE] 테스트할 오디오 파일 경로를 인자로 전달해 주세요.")
        return

    target_file = Path(audio_path)
    if not target_file.exists():
        print(f"[ERROR] 파일이 존재하지 않습니다: {target_file.resolve()}")
        return

    print(f"STT 변환 요청 파일: {target_file.resolve()}")
    print("Azure Speech SDK (ko-KR) 변환 수행 중...")
    
    result_text = await transcribe_audio(str(target_file))

    print("=" * 60)
    print(" [STT 변환 결과]")
    print("=" * 60)
    if result_text:
        print(f"텍스트: {result_text}")
    else:
        print("[경고] STT 변환 결과가 빈 문자열이거나 변환에 실패했습니다.")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
