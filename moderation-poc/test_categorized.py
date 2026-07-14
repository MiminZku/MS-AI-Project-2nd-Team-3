# game_chat_categorized.txt (text|label|category|level 형식)를 이용해서
# OpenAI 판정 결과를 세 가지 각도로 검증하는 스크립트:
# 1) 이진(욕설/정상) 정확도 - 기존과 동일한 기준
# 2) 카테고리 일치율 - 실제 의도한 카테고리(패드립 등)와 모델이 최고점을 준 카테고리가 같은지
# 3) 단계 일치율 - 의도한 단계와 모델이 매긴 단계가 얼마나 가까운지

import os
import json
from dotenv import load_dotenv
from openai import AzureOpenAI, BadRequestError  # BadRequestError: Azure 콘텐츠 필터에 걸려 요청 자체가 차단됐을 때 발생

load_dotenv()

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2025-04-01-preview",
)

DEPLOYMENT_NAME = "gpt-5-mini"

# 팀 정책 문서(4개 카테고리 x 4단계) 기준 프롬프트 - test_openai_moderation.py와 동일
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
4단계(최상급): 미성년자 대상 성적 언급/암시 등 (즉시 최고 수위+수사기관 통보 대상)

[카테고리 3: 패드립 (가족 관련 모욕)] (0=해당없음)
1단계(경미): 가족 관계를 에둘러 암시
2단계(중간): 부모·가족 구성원을 직접 언급한 비하·조롱
3단계(심각): 부모·가족 대상 직접적 욕설, 반복적 가족 비방
4단계(최상급): 고인이 된 가족 모독 결합, 동일 대상에 지속·반복되는 패드립

[카테고리 4: 폭력성 발언] (0=해당없음)
1단계(경미): 구체적 위해 특정 없는 거친 감정 표출, 막연한 적대적 언사
2단계(중간): 대상을 향한 직접적 위협·협박, 게임 내외 위해 암시
3단계(심각): 살상·폭행·고문 등 사실적·잔인한 묘사, 범죄 수단·방법 구체적 설명2 
4단계(최상급): 특정 인물·장소 향한 실제 위해 예고, 중대범죄 미화/사실적 묘사

[최종 판단 규칙]
- 4개 카테고리 각각 0~4단계로 채점
- 최종 등급(final_level)은 4개 카테고리 중 가장 높은 값

반드시 JSON 형식으로만 답하세요. 코드블록(```) 없이, 순수 JSON 텍스트만 출력하세요.
형식: {"category_levels": {"욕설강도": 정수, "음란성발언": 정수, "패드립": 정수, "폭력성발언": 정수}, "final_level": 정수, "confidence": 0~1 사이 실수, "reason": "짧은 이유"}
"""

def classify(text: str) -> dict:
    response = client.responses.create(
        model=DEPLOYMENT_NAME,
        instructions=SYSTEM_PROMPT,
        input=text,
        max_output_tokens=2000,          # 내부 사고+최종답 합쳐서 쓸 수 있는 토큰 여유를 늘림 (빈 응답 방지)
        reasoning={"effort": "low"},     # 내부 사고 단계를 줄여서, 최종 답에 토큰을 더 남겨둠
    )
    raw = response.output_text.strip()
    if not raw:
        raise ValueError("empty_response")  # 빈 응답을 명확한 예외로 구분해서 던짐
    if raw.startswith("```"):
        raw = raw.strip("`").replace("json", "", 1).strip()
    return json.loads(raw)

def classify_with_retry(text: str, max_retries: int = 1) -> dict:
    # 빈 응답은 콘텐츠 필터 때문일 수도 있지만, gpt-5-mini의 일시적 오류일 수도 있음
    # → 바로 실패 처리하지 않고 한 번 더 시도해서, 재시도로 해결되는지 확인
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            return classify(text)
        except (json.JSONDecodeError, ValueError) as e:
            last_error = e
            continue  # 재시도
    raise last_error  # 재시도까지 다 실패하면 그때 진짜 실패로 처리

def load_categorized(path: str):
    # text|label|category|level 4개 컬럼을 읽어오는 함수
    samples = []
    with open(path, encoding="utf-8") as f:
        for line in f.readlines()[1:]:  # 첫 줄은 헤더라서 건너뜀
            parts = line.strip().split("|")
            if len(parts) != 4:
                continue  # 형식이 안 맞는 줄은 건너뜀
            text, label, category, level = parts
            samples.append((text, label, category, level))
    return samples

if __name__ == "__main__":
    samples = load_categorized("game_chat_categorized_DRAFT.txt")

    binary_correct = 0     # 욕설/정상 이진 정답 개수
    category_correct = 0   # 카테고리(욕설강도/음란성발언/패드립/폭력성) 일치 개수
    level_exact = 0        # 단계까지 정확히 일치하는 개수
    level_close = 0        # 단계가 ±1 오차 안에 드는 개수 (완전히 틀린 건 아닌 경우)
    category_total = 0     # 카테고리 비교 대상(정상 문장은 카테고리 비교에서 제외)
    failed = 0             # 빈 응답/JSON 파싱 실패 개수
    content_filtered = 0   # Azure 콘텐츠 필터에 걸려 아예 요청이 차단된 개수 (별도 집계 - 실제 운영에서도 발생 가능한 케이스)

    for text, gold_label, gold_category, gold_level in samples:
        try:
            result = classify_with_retry(text)
        except json.JSONDecodeError:
            failed += 1
            print(f"[!] 응답 실패(재시도 후에도 빈 응답/파싱 실패): {text[:20]}...")
            continue
        except ValueError:
            failed += 1
            print(f"[!] 응답 실패(재시도 후에도 빈 응답): {text[:20]}...")
            continue
        except BadRequestError as e:
            # Azure 콘텐츠 필터가 요청 자체를 차단한 경우 - 실제 운영에서도 벌어질 수 있는 상황이라 별도 기록
            content_filtered += 1
            print(f"[필터차단] {text[:20]}... | 사유: {e.body.get('error', {}).get('code', '알수없음') if hasattr(e, 'body') else str(e)[:50]}")
            continue

        final_level = int(result["final_level"])
        predicted_binary = 0 if final_level == 0 else 1
        cats = result.get("category_levels", {})

        # 여러 카테고리가 동점(최고점)일 때, 팀에서 정한 우선순위로 대표 카테고리를 결정
        # 우선순위: 폭력성 > 패드립 > 음란성발언 > 욕설강도 (이 순서로 심각하다고 판단)
        PRIORITY_ORDER = ["폭력성발언", "패드립", "음란성발언", "욕설강도"]
        if cats:
            max_level = max(cats.values())  # 카테고리들 중 최고 점수 확인
            # 최고 점수를 받은 카테고리들만 추려서, 그중 우선순위가 가장 높은 것을 대표로 선택
            tied_categories = [c for c in PRIORITY_ORDER if cats.get(c, 0) == max_level]
            predicted_category = tied_categories[0] if tied_categories else "없음"
        else:
            predicted_category = "없음"

        if str(predicted_binary) == str(gold_label):
            binary_correct += 1

        # 정상 문장(gold_label=0)은 애초에 카테고리가 없으므로 카테고리/단계 비교에서는 제외
        if gold_label == "1":
            category_total += 1
            if predicted_category == gold_category:
                category_correct += 1
            if str(final_level) == gold_level:
                level_exact += 1
            if abs(final_level - int(gold_level)) <= 1:
                level_close += 1

        print(f"문장: {text[:18]}... | 정답(카테고리/단계):{gold_category}/{gold_level} | "
              f"예측(카테고리/단계):{predicted_category}/{final_level} | 세부:{cats}")

    attempted = len(samples) - failed - content_filtered
    print(f"\n=== 결과 요약 (총 {len(samples)}개 중 정상 판정 {attempted}개) ===")
    print(f"응답 실패(빈 응답): {failed}건 | 콘텐츠 필터 차단: {content_filtered}건")
    print(f"[이진 정확도] {binary_correct}/{attempted} = {binary_correct/attempted*100:.1f}%")
    if category_total > 0:
        print(f"[카테고리 일치율] {category_correct}/{category_total} = {category_correct/category_total*100:.1f}%")
        print(f"[단계 정확 일치] {level_exact}/{category_total} = {level_exact/category_total*100:.1f}%")
        print(f"[단계 ±1 이내] {level_close}/{category_total} = {level_close/category_total*100:.1f}%")