import os
import json
import wave
import httpx
import asyncio
import azure.cognitiveservices.speech as speechsdk

def is_wav_file(filepath: str) -> bool:
    """오디오 파일의 선두 바이트가 'RIFF' 매직 넘버인지 판별합니다."""
    try:
        with open(filepath, "rb") as f:
            header = f.read(4)
            return header == b"RIFF"
    except Exception:
        return False

def convert_to_16k_mono_pcm(filepath: str) -> tuple[bytes, bool]:
    """WAV 오디오 파일을 읽어 16kHz, 16-bit, Mono PCM 바이너리로 변환합니다."""
    try:
        with wave.open(filepath, "rb") as w:
            n_channels = w.getnchannels()
            sampwidth = w.getsampwidth()
            framerate = w.getframerate()
            n_frames = w.getnframes()
            raw_bytes = w.readframes(n_frames)

            if n_channels == 1 and framerate == 16000 and sampwidth == 2:
                return raw_bytes, True

            if sampwidth != 2:
                return raw_bytes, False

            bytes_per_frame = n_channels * 2
            total_frames = len(raw_bytes) // bytes_per_frame
            samples = []

            for i in range(total_frames):
                offset = i * bytes_per_frame
                if n_channels >= 2:
                    l = int.from_bytes(raw_bytes[offset:offset+2], "little", signed=True)
                    r = int.from_bytes(raw_bytes[offset+2:offset+4], "little", signed=True)
                    val = (l + r) // 2
                else:
                    val = int.from_bytes(raw_bytes[offset:offset+2], "little", signed=True)
                samples.append(val)

            if framerate != 16000 and framerate > 0:
                step = framerate / 16000.0
                resampled = []
                idx = 0.0
                while int(idx) < len(samples):
                    resampled.append(samples[int(idx)])
                    idx += step
                samples = resampled

            out_bytes = bytearray()
            for s in samples:
                s_clamped = max(-32768, min(32767, s))
                out_bytes.extend(s_clamped.to_bytes(2, "little", signed=True))

            return bytes(out_bytes), True
    except Exception as e:
        print(f"STT Notice: WAV format parse skipped: {e}")
        return b"", False

async def _transcribe_wav_sdk(filepath: str, speech_key: str, speech_region: str) -> str:
    def _recognize():
        try:
            speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
            speech_config.speech_recognition_language = "ko-KR"
            speech_config.output_format = speechsdk.OutputFormat.Detailed
            speech_config.set_profanity(speechsdk.ProfanityOption.Raw)

            pcm_bytes, converted = convert_to_16k_mono_pcm(filepath)

            push_stream = speechsdk.audio.PushAudioInputStream()
            audio_config = speechsdk.audio.AudioConfig(stream=push_stream)

            if converted and pcm_bytes:
                push_stream.write(pcm_bytes)
                push_stream.close()
            else:
                # 16k mono PCM 변환 실패 시 SDK PushStream을 쓰지 않고 바로 실패 리턴 (REST API로 Fallback 유도)
                print("⚠️ [STT SDK] PCM 변환 실패. SDK 처리를 건너뛰고 REST API로 전환합니다.")
                push_stream.close()
                return ""

            recognizer = speechsdk.SpeechRecognizer(speech_config=speech_config, audio_config=audio_config)
            results = []
            done = False

            def stop_cb(evt):
                nonlocal done
                done = True

            def handle_canceled(evt):
                nonlocal done
                done = True
                print(f"❌ [STT SDK Canceled] Reason: {evt.reason}")
                if evt.reason == speechsdk.CancellationReason.Error:
                    print(f"❌ [STT SDK Error Details] Code: {evt.error_code}, Details: {evt.error_details}")

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
            recognizer.canceled.connect(handle_canceled)

            recognizer.start_continuous_recognition()
            import time
            start_time = time.time()
            while not done:
                time.sleep(0.1)
                if time.time() - start_time > 30:
                    print("❌ [STT SDK Timeout] 30초 인식 시간 초과")
                    break
            recognizer.stop_continuous_recognition()
            return " ".join(results).strip()
        except Exception as e:
            print(f"❌ [STT SDK Exception] {e}")
            return ""

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _recognize)

async def _transcribe_webm_rest(filepath: str, speech_key: str, speech_region: str) -> str:
    url = f"https://{speech_region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=ko-KR"
    
    try:
        with open(filepath, "rb") as f:
            audio_data = f.read()
    except Exception as e:
        print(f"❌ [STT File Read Error] {e}")
        return ""

    if not audio_data:
        print("❌ [STT Error] 업로드된 오디오 데이터가 0 bytes 입니다.")
        return ""

    async with httpx.AsyncClient(timeout=15.0) as client:
        content_types = [
            "audio/webm; codecs=opus",
            "audio/webm",
            "audio/ogg; codecs=opus",
            "audio/wav"
        ]
        
        for ctype in content_types:
            headers = {
                "Ocp-Apim-Subscription-Key": speech_key,
                "Content-Type": ctype
            }
            try:
                response = await client.post(url, headers=headers, content=audio_data)
                if response.status_code == 200:
                    res_json = response.json()
                    text = res_json.get("DisplayText", "").strip()
                    if text:
                        print(f"✅ [STT REST API Success] Content-Type: {ctype} -> {text}")
                        return text
                else:
                    print(f"⚠️ [STT REST API Try Failed] Content-Type: {ctype}, Status: {response.status_code}, Body: {response.text}")
            except Exception as e:
                print(f"⚠️ [STT REST API Exception] Content-Type: {ctype}, Error: {e}")
                continue

    return ""

async def transcribe_audio(filepath: str) -> str:
    """
    Azure Speech SDK 및 REST API를 자동 전환하여 음성 파일(.wav, .webm 등)을 마스킹 없는 텍스트로 변환합니다.
    """
    speech_key = os.environ.get("AZURE_SPEECH_KEY")
    speech_region = os.environ.get("AZURE_SPEECH_REGION")
    
    if not speech_key or not speech_region:
        print("❌ [STT Config Error] .env 파일에 AZURE_SPEECH_KEY 또는 AZURE_SPEECH_REGION 이 없습니다.")
        return ""

    if not os.path.exists(filepath):
        print(f"❌ [STT File Error] 오디오 파일이 존재하지 않습니다: {filepath}")
        return ""

    # 1. WAV(RIFF) 파일이면 SDK PushStream 변환 시도
    if is_wav_file(filepath):
        text = await _transcribe_wav_sdk(filepath, speech_key, speech_region)
        if text:
            return text
        print("⚠️ [STT] SDK 변환 실패 또는 결과 없음. REST API로 Fallback 시도합니다.")

    # 2. WebM / OGG 등 다른 포맷이거나 SDK 실패 시 REST API 변환 시도
    return await _transcribe_webm_rest(filepath, speech_key, speech_region)
