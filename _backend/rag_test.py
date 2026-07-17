import os
from dotenv import load_dotenv
from openai import AzureOpenAI

# 1. .env 파일 로드
current_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path = os.path.join(current_dir, ".env")
load_dotenv(dotenv_path)

# 2. Azure OpenAI 클라이언트 초기화
client = AzureOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_KEY") or os.getenv("AZURE_OPENAI_API_KEY"),
    api_version="2024-12-01-preview"  # On Your Data 벡터 검색 안정 버전을 사용합니다.
)

# 3. 이전에 튜닝해 둔 철저한 시스템 프롬프트 반영
SYSTEM_PROMPT = """당신은 게임 채팅 유해발언 심사역입니다. 당신의 개인적인 상식이나 AI로서의 사전 지식은 완전히 배제하고, 오직 제공된 참조 문서(Context)의 기준만을 바탕으로 판단해야 합니다.

[RAG 문서 엄격 준수 규칙]
1. 사용자가 보낸 채팅 단어 자체의 일반적인 유해성보다, 참조 문서에 적힌 "단계별 조건(예: 대상을 특정하지 않은 짧은 비속어/감탄사성 욕설 1회 = 1단계)"을 최우선으로 적용하세요.
2. 문서에 명확한 근거(예: 미성년자 대상 등)가 없는 한 절대 임의로 4단계를 부여해서는 안 됩니다. 문서의 기준과 다르게 채점하는 것은 오답입니다.

[최종 판단 규칙]
* 4개 카테고리 각각 0~4단계로 채점
* 하나의 발언이 둘 이상의 카테고리에 해당하면 가장 높은 단계를 기준으로 판단
* 미성년자가 발화 대상이거나 관련 내용이 포함되면 카테고리 불문 최상급(4단계)으로 가중 (※ 주의: 미성년자 관련 조건이 없을 때는 본 가중 규칙을 절대 적용하지 마십시오.)

반드시 코드블록(```) 없이 순수 JSON 텍스트로만 답변하세요.
형식: {"category_levels": {"욕설강도": 정수, "음란성발언": 정수, "패드립": 정수, "폭력성발언": 정수},"final_level": 정수, "confidence": 0~1 사이 실수, "reason": "참고 문서 내 어떤 조건을 근거로 몇 단계로 판단했는지 상세히 기술"}"""


def analyze_game_chat(user_chat):
    """
    사용자 채팅을 받아 배포된 임베딩 모델로 AI Search 벡터 검색을 수행한 뒤,
    gpt-4o-mini 모델을 통해 유해 등급을 판정하는 함수
    """
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",  # 배포된 Chat 모델 이름
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_chat}
            ],
            extra_body={
                "data_sources": [
                    {
                        "type": "azure_search",
                        "parameters": {
                            "endpoint": os.getenv("AZURE_SEARCH_ENDPOINT"),
                            "index_name": os.getenv("AZURE_SEARCH_INDEX_NAME"),
                            "authentication": {
                                "type": "api_key",
                                "key": os.getenv("AZURE_SEARCH_KEY")
                            },
                            "query_type": "simple",  # 텍스트 기반 키워드 검색 적용 (벡터 필드가 없는 인덱스)
                            "strictness": 3,  # 문맥 유연성을 위해 엄격도 3 지정
                            "top_n_documents": 5  # 참조할 문서 조각 수
                        }
                    }
                ]
            }
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"🚨 에러가 발생했습니다: {e}"


def main():
    print("=" * 50)
    print("      [게임 채팅 유해성 실시간 심사기 (RAG Vector)]")
    print("=" * 50)
    print("[안내] 종료하려면 영어로 'exit'를 입력하세요.\n")

    while True:
        # 터미널 표준 입력으로 채팅 수집
        user_input = input("[채팅 입력] > ").strip()

        if user_input.lower() == 'exit':
            print("\n[안내] 프로그램을 종료합니다. 고생하셨습니다!")
            break

        if not user_input:
            continue

        print("\n[분석] AI Search 벡터 분석 및 등급 심사 중...")
        result = analyze_game_chat(user_input)

        print("\n[심사 결과]")
        print(result)
        print("-" * 50 + "\n")


if __name__ == "__main__":
    main()