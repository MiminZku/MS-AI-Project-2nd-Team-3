import os
import httpx

async def transcribe_audio(filepath: str) -> str:
    """
    Azure AI Speech REST API를 이용해 음성 파일(.webm 등)을 텍스트로 변환합니다.
    """
    speech_key = os.environ.get("AZURE_SPEECH_KEY")
    speech_region = os.environ.get("AZURE_SPEECH_REGION")
    
    if not speech_key or not speech_region:
        print("STT: Azure Speech keys missing in .env")
        return ""

    if not os.path.exists(filepath):
        print(f"STT: File not found - {filepath}")
        return ""

    url = f"https://{speech_region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ko-KR"
    
    # 브라우저에서 녹음된 webm (opus) 포맷 시도
    headers = {
        "Ocp-Apim-Subscription-Key": speech_key,
        "Content-Type": "audio/webm; codecs=opus"
    }

    try:
        with open(filepath, "rb") as f:
            audio_data = f.read()
    except Exception as e:
        print(f"STT: Audio file read error: {e}")
        return ""

    async with httpx.AsyncClient() as client:
        try:
            # 1차 시도 (webm 헤더)
            response = await client.post(url, headers=headers, content=audio_data)
            if response.status_code == 200:
                result = response.json()
                return result.get("DisplayText", "")
            
            # 2차 시도 (ogg 헤더 폴백 - Azure REST API 공식 지원 포맷)
            print(f"STT 1st try failed ({response.status_code}). Trying OGG fallback...")
            headers["Content-Type"] = "audio/ogg; codecs=opus"
            response2 = await client.post(url, headers=headers, content=audio_data)
            
            if response2.status_code == 200:
                result = response2.json()
                return result.get("DisplayText", "")
            else:
                print(f"STT Error: {response2.status_code} - {response2.text}")
                return ""
        except Exception as e:
            print(f"STT Request Exception: {e}")
            return ""
