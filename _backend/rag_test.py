import os
from dotenv import load_dotenv
from openai import AzureOpenAI
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

# 1. 환경 변수 로드
load_dotenv()

# 2. 클라이언트 개별 초기화
ai_client = AzureOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version="2025-04-01-preview"
)

search_client = SearchClient(
    endpoint=os.getenv("AZURE_SEARCH_ENDPOINT"),
    index_name=os.getenv("AZURE_SEARCH_INDEX_NAME"),
    credential=AzureKeyCredential(os.getenv("AZURE_SEARCH_KEY"))
)

def search_rag_documents(query, top_n=3, strictness_level=1): # 테스트를 위해 우선 1로 세팅
    try:
        # 1. 사용자의 질문을 임베딩 모델을 사용해 벡터(숫자 배열)로 실시간 변환
        embedding_response = ai_client.embeddings.create(
            model="text-embedding-3-small",  # 본인의 임베딩 모델 배포명
            input=query
        )
        query_vector = embedding_response.data[0].embedding

        # 2. 벡터 검색 쿼리 객체 생성
        vector_query = VectorizedQuery(
            vector=query_vector, 
            k_nearest_neighbors=top_n, 
            fields="text_vector"
        )

        # 3. 하이브리드 검색 수행 (텍스트 키워드 + 벡터 쿼리 동시 투입 + 시맨틱 랭커)
        results = search_client.search(
            search_text=query,
            vector_queries=[vector_query], # 👈 벡터 데이터 주입!
            query_type="semantic",
            semantic_configuration_name="rag-1784298934553-semantic-configuration",
            top=top_n
        )
        
        # strictness 커트라인 설정
        thresholds = {1: 0.0, 2: 1.0, 3: 1.5, 4: 2.0, 5: 2.5}
        cutoff_score = thresholds.get(strictness_level, 0.0)
        
        context_chunks = []
        for doc in results:
            semantic_score = doc.get("@search.reranker_score", 0.0)
            
            if semantic_score < cutoff_score:
                continue 
                
            content = doc.get("chunk") or ""
            if content:
                context_chunks.append(content)
                
        return "\n\n".join(context_chunks)
        
    except Exception as e:
        print(f"⚠️ 검색 오류: {e}")
        return ""

def analyze_chat_with_rag(user_chat):
    # 1단계: 사용자가 친 채팅 맥락과 가장 유사한 규정 문서 조각을 AI Search에서 직접 긁어옴
    retrieved_context = search_rag_documents(user_chat)
    
    # 2단계: 긁어온 문서를 시스템 프롬프트에 동적으로 조립해서 쥐여줌
    dynamic_system_prompt = f"""당신은 게임 채팅 유해발언 심사역입니다. 당신의 개인적인 상식은 배제하고, 아래 제공된 [참조 규정 문서]의 기준만을 바탕으로 대상의 지칭성 여부를 판단하여 단계를 결정해야 합니다.

[참조 규정 문서]
{retrieved_context}

반드시 JSON 텍스트로만 답변하세요.
형식: {{"category_levels": {{"욕설강도": 정수, "음란성발언": 정수, "패드립": 정수, "폭력성발언": 정수}},"auxiliary_tags":문자열 배열,"urgent_flags":문자열 배열,"final_level": 정수, "confidence": 0~1 사이 실수, "reason": "참조 규정 문서 내 어떤 구체적인 조건과 대조하여 몇 단계로 판단했는지 상세히 기술"}}

[판정 예시 (Few-shot)]
- 입력 채팅: "라준호 뇌 없음? 진짜 손가락 부러졌나"
  * 판단 논리: '라준호'라는 특정 유저의 닉네임을 언급하며 '뇌 없음'이라는 비하 발언을 유도함. 대상이 명확히 특정되었으므로 단순 욕설 1단계가 아닌, 지칭성 비하 규칙에 의거하여 욕설강도 [2단계] 적용.
  * 최종 출력 JSON: {{"category_levels": {{"욕설강도": 2, "음란성발언": 0, "패드립": 0, "폭력성발언": 0}}, "final_level": 2, ...}}

- 입력 채팅: "아 진짜 시발 개짜증나네"
  * 판단 논리: 대상을 지정하지 않고 본인의 감정을 배설하는 단순 비속어 사용이므로 규칙에 따라 욕설강도 [1단계] 적용.
"""

    # 3단계: 순수 Chat Completion 호출 (글로벌 표준 제약에 걸리지 않음)
    try:
        response = ai_client.chat.completions.create(
            model="gpt-5-mini",
            messages=[
                {"role": "system", "content": dynamic_system_prompt},
                {"role": "user", "content": user_chat}
            ]
        )
        return response.choices[0].message.content
    except Exception as e:
        import json
        error_msg = str(e)
        
        # 1. 콘텐츠 필터링에 의한 에러인지 구체적으로 구별합니다.
        is_content_filter = False
        
        # openai.BadRequestError의 경우 e.body 구조에 'error'가 포함되어 있습니다.
        if hasattr(e, 'body') and isinstance(e.body, dict):
            error_data = e.body.get('error', {})
            if isinstance(error_data, dict):
                if error_data.get('code') == 'content_filter':
                    is_content_filter = True
                elif 'content management policy' in error_data.get('message', '').lower():
                    is_content_filter = True
        
        # 에러 메시지 문자열에 키워드가 포함되었는지 보조적으로 검사합니다.
        if not is_content_filter and ('content_filter' in error_msg.lower() or 'content management policy' in error_msg.lower()):
            is_content_filter = True

        if is_content_filter:
            # 콘텐츠 필터에 의해 입력 자체가 차단된 경우에만 안전 장치로 Lv.4 판정을 내립니다.
            fallback_result = {
                "category_levels": {
                    "욕설강도": 4, 
                    "음란성발언": 4, 
                    "패드립": 4, 
                    "폭력성발언": 4
                },
                "auxiliary_tags": ["콘텐츠필터차단"],
                "urgent_flags": ["필터차단"],
                "final_level": 4,
                "confidence": 1.0,
                "reason": f"Azure Content Safety 필터에 의해 입력이 차단되었습니다. (원인: {error_msg[:120]})"
            }
            return json.dumps(fallback_result, ensure_ascii=False)
        else:
            # 엔드포인트/인증키가 다르거나 파라미터가 잘못되어 발생하는 일반적인 에러는 그대로 에러 메시지를 반환합니다.
            return f"🚨 API 에러가 발생했습니다: {e}"

def main():
    print("=" * 60)
    print("     🎮 글로벌 제약 우회형 유해성 실시간 심사기 (Pure Python RAG) 🎮")
    print("=" * 60)
    print("👉 종료하려면 영어로 'exit'를 입력하세요.\n")

    while True:
        user_input = input("🗣️  채팅 입력 > ").strip()
        if user_input.lower() == 'exit':
            break
        if not user_input:
            continue

        print("\n🔍 가이드라인 문서 벡터 매칭 및 유해 등급 심사 중...")

        # 1. 어떤 문서를 가져오는지 먼저 가로채서 출력해보기
        retrieved_context = search_rag_documents(user_input)
        print("\n📋 [AI Search가 찾아온 실제 가이드라인 내용]:")
        print(retrieved_context if retrieved_context else "⚠️ 매칭된 문서 없음!")
        print("-" * 40)

        # 2. 그 다음 심사 요청
        result = analyze_chat_with_rag(user_input)
        print("\n📊 [심사 결과]")
        print(result)
        print("-" * 60 + "\n")

if __name__ == "__main__":
    main()