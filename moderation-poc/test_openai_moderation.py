# Azure OpenAI가 게임 욕설/혐오표현을 얼마나 잘 잡는지 빠르게 확인하는 스크립트
# 이미 갖고 있는 Curse-detection-data(pipe-delimited, 5,825문장)에서 일부만 뽑아 테스트합니다.

import os          # 환경변수에서 키/엔드포인트를 읽어오기 위해 사용
import json        # OpenAI 응답을 JSON으로 파싱하기 위해 사용
from dotenv import load_dotenv  # .env 파일을 읽어서 환경변수로 등록해주는 라이브러리 (pip install python-dotenv --break-system-packages)
from openai import AzureOpenAI  # Azure OpenAI 전용 클라이언트 (pip install openai --break-system-packages)

load_dotenv()  # 같은 폴더에 있는 .env 파일을 찾아서 그 안의 값들을 환경변수로 불러옴

# 1) Azure OpenAI 클라이언트 생성
# endpoint, api_key는 Azure Portal의 "키 및 엔드포인트" 메뉴에서 복사한 값을 그대로 넣으면 됩니다.
client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],   # 예: https://<리소스이름>.openai.azure.com/
    api_key=os.environ["AZURE_OPENAI_KEY"],               # Portal에서 복사한 API 키
    api_version="2025-04-01-preview",                     # gpt-5 계열(reasoning 모델) 지원을 위해 최신 버전 사용
)

# Foundry 배포 화면에서 확인한 실제 "배포 이름" (환경변수가 있으면 사용하고 기본값은 gpt-5-mini로 유지)
DEPLOYMENT_NAME = os.environ.get("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-mini")

# 2) 판정 기준을 담은 시스템 프롬프트
# 실제 RAG 규정 지침 DB 대신, 지금은 4단계 등급 체계를 프롬프트에 직접 넣어서 빠르게 테스트합니다.
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
형식: {"category_levels": {"욕설강도": 정수, "음란성발언": 정수, "패드립": 정수, "폭력성발언": 정수}, "final_level": 정수, "confidence": 0~1 사이 실수, "reason": "짧은 이유"}
"""

def classify(text: str) -> dict:
    # 한 문장을 OpenAI에 보내서 등급 판정을 JSON으로 받아오는 함수
    # Azure OpenAI는 Responses API를 직접 지원하지 않으므로 Chat Completions를 사용합니다.
    response = client.chat.completions.create(
        model=DEPLOYMENT_NAME,          # 배포 이름 지정
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text}
        ],
        # reasoning 계열 모델(gpt-5-mini)은 temperature 파라미터를 지원하지 않아 제거함
        # → 대신 temperature=0이 해주던 "일관성"은 SYSTEM_PROMPT 지시로 최대한 확보
    )
    raw = response.choices[0].message.content           # Chat Completions의 텍스트 응답 추출
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # ```json ... ``` 형태로 감싸서 줄 경우, 앞뒤 코드블록 표시를 제거
        cleaned = cleaned.strip("`")
        cleaned = cleaned.replace("json", "", 1).strip()
    return json.loads(cleaned)           # 정리된 문자열을 파이썬 dict로 변환

def load_sample(path: str, n: int = 30):
    # Curse-detection-data(pipe-delimited)에서 앞부분 n개 문장만 샘플로 불러오는 함수
    samples = []
    with open(path, encoding="utf-8") as f:
        for line in f.readlines()[1:n+1]:   # 첫 줄은 헤더라고 가정하고 건너뜀
            text, label = line.strip().split("|")  # "문장|라벨" 형식 분리
            samples.append((text, label))
    return samples

if __name__ == "__main__":
    # 실제 파일 경로는 본인 환경에 맞게 수정하세요
    samples = load_sample("curse_detection_data.txt", n=30)

    correct = 0          # 5단계 그대로 맞춘 개수 (Lv.0~4 정확히 일치)
    binary_correct = 0   # 이진 변환 후 맞춘 개수 (욕설이냐/아니냐만 비교, 원본 데이터 라벨 방식과 동일)
    failed = 0           # 빈 응답/파싱 실패 등으로 판정 자체가 안 된 개수
    for text, gold_label in samples:
        try:
            result = classify(text)                     # OpenAI 판정 요청
        except json.JSONDecodeError:
            # 빈 응답이거나 JSON이 아닌 답이 온 경우 (콘텐츠 필터에 막혔을 가능성 높음)
            failed += 1
            print(f"[!] 응답 실패(빈 응답/필터 추정): {text[:20]}...")
            continue  # 이 문장은 건너뛰고 다음 문장으로 계속 진행

        predicted = result["final_level"]            # 4개 카테고리 중 최고 등급 (0~4)
        predicted_binary = 0 if int(predicted) == 0 else 1  # Lv.1 이상이면 전부 "욕설(1)"로 변환
        match_exact = "O" if str(predicted) == str(gold_label) else "X"     # 5단계 그대로 비교
        match_binary = "O" if str(predicted_binary) == str(gold_label) else "X"  # 이진 변환 비교

        if match_exact == "O":
            correct += 1
        if match_binary == "O":
            binary_correct += 1

        cats = result.get("category_levels", {})  # 카테고리별 세부 등급도 같이 출력 (어느 카테고리가 걸렸는지 확인용)
        print(f"[{match_exact}|{match_binary}] 문장: {text[:20]}... | 정답:{gold_label} 최종:{predicted} 카테고리:{cats} conf:{result['confidence']}")

    # 두 가지 기준의 정확도를 같이 출력 (앞의 [ ]는 "5단계|이진" 순서)
    attempted = len(samples) - failed
    print(f"\n[5단계 그대로] 정확도: {correct}/{attempted} = {correct/attempted*100:.1f}%")
    print(f"[욕설/정상 이진 변환] 정확도: {binary_correct}/{attempted} = {binary_correct/attempted*100:.1f}% (KcELECTRA 90.5%와 비교할 기준)")
    print(f"판정 실패(빈 응답) {failed}건 제외")