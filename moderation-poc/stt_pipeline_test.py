# Azure Speech Studio에서 받은 STT 결과 JSON을 실제로 파싱해서,
# (마스킹 안 된) 원문을 추출한 다음 OpenAI 판정기까지 그대로 넘기는
# "음성 -> 텍스트 -> 판정" 엔드투엔드 테스트 스크립트.

import os
import json
from dotenv import load_dotenv
from openai import AzureOpenAI, BadRequestError

load_dotenv()

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2025-04-01-preview",
)

DEPLOYMENT_NAME = "gpt-5-mini"

# ⚠️ test_categorized.py의 최신 SYSTEM_PROMPT를 그대로 복사해서 여기 붙여넣으세요.
SYSTEM_PROMPT = """당신은 게임 채팅 유해발언 심사역입니다. 아래 기준에 따라 채팅 한 줄을 분석하세요.

[공통 판단 원칙] 아래 요소를 종합적으로 고려해서 단계를 정하세요.
- 대상 특정 여부: 불특정 다수보다 특정 개인/집단을 지목하면 심각도 높음
- 반복성·지속성: 도배 형태면 가중
- 고의성: 의도적으로 피해를 주려는 표현이면 더 높은 단계
- 완곡 표현·우회: 초성, 특수문자, 유사 발음으로 우회해도 원문과 동일하게 판단
- 사회통념상 불쾌감: 일반적 사회통념 기준 불쾌감/수치심 유발 정도
- 미성년자 관련: 미성년자 대상/언급 시 카테고리 불문 무조건 4단계로 가중

[역할 구분 및 저지 이용자 판정] 발언의 내용 분류와 화자의 역할 판정을 분리해서 먼저 판단하세요.
- 유해발언 사용자: 욕설·음란성·패드립·폭력성 발언을 작성·전송·반복한 이용자. 상대를 직접 모욕하거나 위협·성적 표현·가족 비방을 게시한 경우.
- 저지 이용자(제지 발언자): 유해발언 사용자에게 중단을 요구하거나 신고·중재 등으로 발언을 막으려 한 이용자. 필터링 목록의 표현이 포함되었더라도, 문맥상 유해발언을 제지·신고·중재하기 위해 인용한 경우에는 저지 이용자를 유해발언 사용자로 자동 판정하지 않습니다.
- 판정 시 필터링 목록 일치 여부만으로 확정하지 말고, 대상·의도·반복성·문맥을 함께 확인하세요.

[0단계 및 화자 구분 세부 기준] 단순한 감정 표현·항의·신고·중재 발언은 원칙적으로 0단계입니다.
- 항의·경고·신고: 화자 본인이 상대를 가해하는 것이 아니라 상대의 이전 행동에 중단·신고·경고 의사를 밝히는 경우 카테고리별 0단계로 판정하세요.
  예: "그런 식으로 말하는 거 그만해줄래" / "신고할 거야" / "외모 얘기 좀 그만하지"
- 실제 금칙어 인용: 제지 목적이어도 특정 슬랭·비속어·성적 단어 자체가 채팅에 그대로 노출되면, 그 단어가 노출된 사실 자체는 남으므로 해당 단어의 카테고리·단계를 원래 기준대로 판정하세요.
  예: "쌍년이라는 말 좀 그만해" → 욕설 강도 1
- 추상적 지칭: 구체적 단어 없이 "그런 소리", "이상한 발언", "그런 행동"처럼 추상적으로만 지칭하면 0단계입니다.
  예: "그런 소리 그만해" / "이상한 발언 하지 마"
- 위장 항의: 항의 형식을 취했더라도 상대를 재조롱하거나 비꼬는 의도가 명백하면, 항의 형식과 무관하게 실제 공격 발화로 원래 기준대로 판정하세요.

[세부 보정 예시]
- 욕설 1단계: "찐따같이 왜 그러냐" / "바보냐 정신 좀 차려" / "멍청한 짓 좀 그만해" → 짧은 1회성 표현, 대상 지목이 약함
- 욕설 2단계: "한심한 미드 뭐하냐 계속 죽네" / "이딴 팀원들만 모였냐" → 특정 이용자 또는 집단을 지목한 비하
- 패드립 1단계: "집에서 그렇게 안 가르쳤을 것 같은데" / "본받을 사람이 없었나보네" / "어디서 그런 버릇을 배웠대" → 가족·보호자·가정교육을 간접 암시
- 정상 감정(모든 카테고리 0단계): "아 열받네 진짜" / "진짜 성질 나서 미치겠다" → 특정 대상 없는 감정 표출

[폭력성 구체성 보정] 잔인한 묘사가 없더라도 "구체적 대상 특정 + 실행 의지 표명"이 결합하면 폭력성 3단계 이상으로 판정합니다. 실제 장소·거주지·신상 단서가 확인되고 위해가 예고되면 4단계로 가중합니다.
- "다음에 만나면 진짜 가만 안 둔다" → 폭력성 2 (직접 위협이나 구체적 수단·장소 없음)
- "너 사는 동네 캐릭터 보니까 대충 알겠던데" / "몽둥이 들고 찾아갈까 고민 중" → 폭력성 3 (신상 단서 또는 구체적 수단과 실행 의지 결합)
- "너희 집 몇 호인지 이미 알아냈다 조심해" → 폭력성 4 (실거주지 특정 후 실제 위해 예고)

[보조 태그] 기본 4개 카테고리만으로 분류하기 어려운 유해행위는 해당하는 경우 auxiliary_tags에 추가하세요 (해당 없으면 빈 배열).
- 혐오·차별: 인종·국적·성별·성적지향·장애·종교 등 정체성을 이유로 공격·비하
- 개인정보: 주소·학교·직장·전화번호·실명·계정정보 등을 공개하거나 공개를 협박
- 자해 조장: 자살 또는 자해를 권유·조롱·선동하거나 실행을 부추기는 표현
- 성적 괴롭힘: 반복적인 성적 요구, 비동의 성적 제안, 만남·사진·신체 정보 요구
- 스팸·도배: 동일·유사 문장 반복, 의미 없는 대량 채팅, 광고·링크 도배
- 사기·피싱: 외부 링크, 계정·아이템 거래, 로그인 정보·인증번호 요구 등 사기성 유도
- 사칭: 운영자·상담원·다른 이용자를 사칭하거나 허위 권한 주장

[긴급 플래그] 즉시 별도 검토가 필요한 사안은 해당하는 경우 urgent_flags에 추가하세요 (해당 없으면 빈 배열). 하나라도 해당하면 반드시 final_level을 4로 설정하세요.
- 미성년자 성착취: 미성년자 대상 성적 접근·착취·성착취물 관련 언급·유포
- 실제 신상 노출: 실제 주소·거주지·학교·직장 등 식별 가능한 신상정보 노출
- 실제 위해 예고: 특정 인물·장소에 대한 실제 폭행·살해·방화 등 위해 실행 예고
- 자살·자해 조장: 구체적인 자살·자해 실행을 권유하거나 실행 방법·시점을 부추기는 표현

[카테고리 1: 욕설 강도] (0=해당없음)
1단계(경미): 대상을 특정하지 않은 짧은 비속어 또는 감탄사성 욕설을 1회 사용
2단계(중간): 특정 대상을 향한 욕설·비방, 모욕적 별명, 짧은 시간 내 반복
3단계(심각): 지속·반복적 욕설, 조롱을 통한 모욕·명예훼손, 차별적 비하
4단계(최상급): 조직적·집단적 욕설, 성적 표현·폭력적 위협과 결합된 욕설, 업무 담당자 대상 지속적 욕설

[카테고리 2: 음란성 발언] (0=해당없음)
1단계(경미): 은유적·간접적 성적 암시, 이중적 의미의 농담
2단계(중간): 신체 부위를 직접 언급하거나 성적 수치심을 유발하는 표현
3단계(심각): 성행위·신체 노출의 직접 묘사, 특정 대상에게 성적 수치심을 주는 발언, 성적 이미지 게시
4단계(최상급): 미성년자 대상 성적 언급·암시, 성착취물 관련 언급·유포 등 위법성이 명백한 표현

[카테고리 3: 패드립 (가족 관련 모욕)] (0=해당없음)
1단계(경미): 가족 관계를 에둘러 언급하거나 간접적으로 암시
2단계(중간): 부모·가족 구성원을 직접 지칭한 비하·조롱
3단계(심각): 부모·가족을 대상으로 한 노골적·반복적 욕설
4단계(최상급): 고인 모독이 결합되거나 동일 대상에게 지속·반복적으로 가하는 경우

[카테고리 4: 폭력성 발언] (0=해당없음)
1단계(경미): 구체적 위해를 특정하지 않은 거친 감정 표출·막연한 적대적 언사
2단계(중간): 특정 대상을 향한 직접적 협박 또는 게임 내·외 위해 암시
3단계(심각): 살상·폭행·고문 등 잔인한 폭력 묘사 또는 범죄 수단·방법 설명 (위 [폭력성 구체성 보정] 기준도 함께 적용)
4단계(최상급): 특정 인물·장소에 대한 실제 위해 예고, 범죄 교사·방조·선동 등

[최종 판단 규칙]
- 4개 카테고리 각각 0~4단계로 채점
- 최종 등급(final_level)은 4개 카테고리 단계의 최댓값 (단, urgent_flags가 하나라도 있으면 무조건 4)
- 하나의 발언이 둘 이상의 카테고리에 해당하면 가장 높은 단계를 기준으로 판단
- 미성년자가 발화 대상이거나 관련 내용이 포함되면 카테고리 불문 최상급(4단계)으로 가중

반드시 JSON 형식으로만 답하세요. 코드블록(```) 없이, 순수 JSON 텍스트만 출력하세요.
형식: {"category_levels": {"욕설강도": 정수, "음란성발언": 정수, "패드립": 정수, "폭력성발언": 정수}, "auxiliary_tags": [문자열 배열], "urgent_flags": [문자열 배열], "final_level": 정수, "confidence": 0~1 사이 실수, "reason": "짧은 이유"}
"""

def classify(text: str) -> dict:
    response = client.responses.create(
        model=DEPLOYMENT_NAME,
        instructions=SYSTEM_PROMPT,
        input=text,
        max_output_tokens=2000,
        reasoning={"effort": "low"},
    )
    raw = response.output_text.strip()
    if not raw:
        raise ValueError("empty_response")
    if raw.startswith("```"):
        raw = raw.strip("`").replace("json", "", 1).strip()
    return json.loads(raw)


def classify_with_retry(text: str, max_retries: int = 1) -> dict:
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            return classify(text)
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            continue
    raise last_error


def extract_lexical_segments(stt_json_path: str) -> list:
    # Azure Speech STT 결과 JSON에서, 마스킹 안 된 "Lexical" 필드만 뽑아오는 함수.
    # 너무 짧은 감탄사성 발화("아", "음" 등)는 판정 의미가 없어서 걸러냄.
    with open(stt_json_path, encoding="utf-8") as f:
        data = json.load(f)

    segments = []
    for item in data:
        if item.get("RecognitionStatus") != "Success":
            continue  # 인식 실패한 구간은 건너뜀
        nbest = item.get("NBest", [])
        if not nbest:
            continue
        lexical = nbest[0].get("Lexical", "").strip()  # 1순위 후보의 원문(마스킹 없음)
        if len(lexical) < 2:
            continue  # "아", "음" 같은 의미 없는 1글자 발화는 제외
        segments.append(lexical)
    return segments


if __name__ == "__main__":
    # ↓↓↓ Azure Speech Studio에서 다운로드한 STT 결과 JSON 파일 경로를 넣으세요 ↓↓↓
    STT_JSON_PATH = "stt_result.json"

    segments = extract_lexical_segments(STT_JSON_PATH)
    print(f"STT에서 추출한 판정 대상 발화: {len(segments)}개\n")

    PRIORITY_ORDER = ["폭력성발언", "패드립", "음란성발언", "욕설강도"]

    for text in segments:
        try:
            result = classify_with_retry(text)
        except (json.JSONDecodeError, ValueError):
            print(f"[!] 판정 실패(빈 응답) → 관리자 검토로 전달: {text}")
            continue
        except BadRequestError as e:
            reason = e.body.get('error', {}).get('code', '알수없음') if hasattr(e, 'body') else str(e)[:50]
            print(f"[!] 콘텐츠 필터 차단({reason}) → 관리자 검토로 전달: {text}")
            continue

        cats = result.get("category_levels", {})
        aux_tags = result.get("auxiliary_tags", [])
        urgent = result.get("urgent_flags", [])
        final_level = result.get("final_level", 0)

        if urgent:
            final_level = 4

        if cats and max(cats.values(), default=0) > 0:
            max_level = max(cats.values())
            tied = [c for c in PRIORITY_ORDER if cats.get(c, 0) == max_level]
            predicted_category = tied[0] if tied else "없음"
        elif urgent:
            predicted_category = "긴급(카테고리 미상)"
        else:
            predicted_category = "정상"

        print(f"[STT 원문] {text}")
        print(f"  → 판정: {predicted_category} / {final_level}단계")
        print(f"  → 세부: {cats}")
        if urgent:
            print(f"  → 🚨 긴급 플래그: {urgent}")
        if aux_tags:
            print(f"  → 🏷️ 보조 태그: {aux_tags}")
        print(f"  → 이유: {result.get('reason', '')}")
        print()
