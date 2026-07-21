import os
import json
import asyncio
import azure.cognitiveservices.speech as speechsdk

async def transcribe_audio(filepath: str) -> str:
    """
    Azure Speech SDK를 이용해 음성 파일(.wav, .webm, .ogg 등)을 텍스트(원문/마스킹 없음)로 변환합니다.
    """
    speech_key = os.environ.get("AZURE_SPEECH_KEY")
    speech_region = os.environ.get("AZURE_SPEECH_REGION")
    
    if not speech_key or not speech_region:
        print("STT: Azure Speech keys missing in .env")
        return ""

    if not os.path.exists(filepath):
        print(f"STT: File not found - {filepath}")
        return ""

    def _recognize_all() -> str:
        try:
            speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
            speech_config.speech_recognition_language = "ko-KR"
            speech_config.output_format = speechsdk.OutputFormat.Detailed
            speech_config.set_profanity(speechsdk.ProfanityOption.Raw)

            audio_config = speechsdk.audio.AudioConfig(filename=filepath)
            recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)

            results = []
            done = False

            def stop_cb(evt):
                nonlocal done
                done = True

            def handle_result(evt):
                if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                    try:
                        detail = json.loads(evt.result.json)
                        nbest = detail.get("NBest", [])
                        if nbest:
                            lexical = nbest[0].get("Lexical", "").strip()
                            if lexical:
                                results.append(lexical)
                        elif evt.result.text:
                            results.append(evt.result.text)
                    except Exception:
                        if evt.result.text:
                            results.append(evt.result.text)

            recognizer.recognized.connect(handle_result)
            recognizer.session_stopped.connect(stop_cb)
            recognizer.canceled.connect(stop_cb)

            recognizer.start_continuous_recognition()
            
            import time
            start_time = time.time()
            while not done:
                time.sleep(0.1)
                if time.time() - start_time > 30:  # 30초 타임아웃
                    print("STT: Continuous recognition timeout (30s)")
                    break
                    
            recognizer.stop_continuous_recognition()
            return " ".join(results).strip()
            
        except Exception as e:
            print(f"STT SDK Exception: {e}")
            return ""

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _recognize_all)
