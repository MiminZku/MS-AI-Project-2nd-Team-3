import os
import json
from openai import AzureOpenAI
from dotenv import load_dotenv

load_dotenv()

try:
    client = AzureOpenAI(
        azure_endpoint=os.environ.get("AZURE_OPENAI_ENDPOINT", ""),
        api_key=os.environ.get("AZURE_OPENAI_KEY", ""),
        api_version="2025-04-01-preview"
    )
except Exception as e:
    client = None

DEPLOYMENT_NAME = "gpt-5-mini"

SYSTEM_PROMPT = """당신은 게임 채팅 유해발언 심사역입니다. 아래 4개 카테고리 기준에 따라 채팅 한 줄을 분석하세요.

[공통 판단 원칙] 아래 요소를 종합적으로 고려해서 단계를 정하세요.
- 대상 특정 여부: 불특정 다수보다 특정 개인/집단을 지목하면 심각도 높음
- 반복성·지속성: 도배 형태면 가중
- 고의성: 의도적으로 피해를 주려는 표현이면 더 높은 단계
- 완곡 표현·우회: 초성, 특수문자, 유사 발음으로 우회해도 원문과 동일하게 판단
- 사회통념상 불쾌감: 일반적 사회통념 기준 불쾌감/수치심 유발 정도
- 미성년자 관련: 미성년자 대상/언급 시 카테고리 불문 무조건 4단계로 가중

[카테고리 1: 욕설 강도] (0=해당없음)
1단계(경미): 대상 미특정 짧은 비속어 1회
2단계(중간): 특정 대상을 직접 지목한 욕설·모욕적 별명, 짧은 시간 내 반복
3단계(심각): 동일 대상 지속·반복 욕설(도배 포함), 명예훼손급 조롱, 정치·인종·민족·종교·성별·장애를 결부한 비하성 욕설
4단계(최상급): 여러 계정 동원한 집단적 욕설, 성적/폭력적 위협과 결합, 상담원 등 서비스 담당자 대상 지속 욕설

[카테고리 2: 음란성 발언] (0=해당없음)
1단계(경미): 은유적·간접적 성적 암시, 이중적 의미 농담
2단계(중간): 신체 부위 직접 언급, 성적 수치심 유발 발언
3단계(심각): 성행위·신체 노출 등 직접 묘사, 대상 특정 성적 수치심 발언, 성적 이미지 전송
4단계(최상급): 미성년자 대상 성적 언급/암시, 미성년자와 성적 접촉 목적 관계 형성 시도, 성착취물 관련 언급·유포 (즉시 최고 수위+수사기관 통보 대상)

[카테고리 3: 패드립 (가족 관련 모욕)] (0=해당없음)
1단계(경미): 가족 관계를 에둘러 암시
2단계(중간): 부모·가족 구성원을 직접 언급한 비하·조롱
3단계(심각): 부모·가족 대상 직접적 욕설, 반복적 가족 비방
4단계(최상급): 고인이 된 가족 모독 결합, 동일 대상에 지속·반복되는 패드립

[카테고리 4: 폭력성 발언] (0=해당없음)
1단계(경미): 구체적 위해 특정 없는 거친 감정 표출, 막연한 적대적 언사
2단계(중간): 대상을 향한 직접적 위협·협박, 게임 내외 위해 암시
3단계(심각): 살상·폭행·고문 등 사실적·잔인한 묘사, 범죄 수단·방법 구체적 설명
4단계(최상급): 특정 인물·장소 향한 실제 위해 예고, 아동학대·유괴·인신매매 미화/사실적 묘사, 범죄 교사·방조·선동

[최종 판단 규칙]
- 4개 카테고리 각각 0~4단계로 채점
- 최종 등급(final_level)은 4개 카테고리 중 가장 높은 값
- 서로 다른 카테고리에서 동시에 해당해도 최고 단계 하나만 최종값으로 사용

반드시 JSON 형식으로만 답하세요. 코드블록(```) 없이, 순수 JSON 텍스트만 출력하세요.
형식: {"category_levels": {"욕설강도": 정수, "음란성발언": 정수, "패드립": 정수, "폭력성발언": 정수}, "final_level": 정수, "confidence": 0.0~1.0, "reason": "짧은 이유"}
"""

async def analyze_chat(text: str) -> dict:
    if not client:
        return {"final_level": 0, "reason": "OpenAI client not configured"}

    try:
        response = client.responses.create(
            model=DEPLOYMENT_NAME,
            instructions=SYSTEM_PROMPT,
            input=text,
        )
        raw = response.output_text
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            cleaned = cleaned.replace("json", "", 1).strip()
        return json.loads(cleaned)
    except Exception as e:
        print(f"[OpenAI Error] {e}")
        return {"final_level": 0, "reason": "Error during analysis"}
