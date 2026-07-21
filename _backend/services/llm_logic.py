import os
import json
from openai import AzureOpenAI, BadRequestError
from dotenv import load_dotenv
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

load_dotenv()

try:
    client = AzureOpenAI(
        azure_endpoint=os.environ.get("AZURE_OPENAI_ENDPOINT", ""),
        api_key=os.environ.get("AZURE_OPENAI_KEY", ""),
        api_version="2025-04-01-preview"
    )
except Exception as e:
    client = None

DEPLOYMENT_NAME = os.environ.get("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-mini")

INDEX_NAME = os.environ.get("AZURE_SEARCH_INDEX_NAME", "")
try:
    search_client = SearchClient(
        endpoint=os.environ.get("AZURE_SEARCH_ENDPOINT", ""),
        index_name=INDEX_NAME,
        credential=AzureKeyCredential(os.environ.get("AZURE_SEARCH_KEY", ""))
    )
    SEMANTIC_CONFIG = f"{INDEX_NAME}-semantic-configuration"
except Exception as e:
    search_client = None
    SEMANTIC_CONFIG = ""

def search_rag_documents(query: str, top_n: int = 8, strictness_level: int = 1) -> str:
    """사용자 채팅 내용을 기반으로 Azure Search에서 관련 규정 문서를 검색합니다."""
    if not search_client or not client:
        return ""
    try:
        emb = client.embeddings.create(model="text-embedding-3-small", input=query)
        vector_query = VectorizedQuery(
            vector=emb.data[0].embedding,
            k_nearest_neighbors=top_n,
            fields="text_vector",
        )
        results = search_client.search(
            search_text=query,
            vector_queries=[vector_query],
            query_type="semantic",
            semantic_configuration_name=SEMANTIC_CONFIG,
            top=top_n,
        )
        thresholds = {1: 0.0, 2: 0.5, 3: 0.8, 4: 1.0, 5: 1.2}
        cutoff = thresholds.get(strictness_level, 0.0)

        chunks = []
        for doc in results:
            if doc.get("@search.reranker_score", 0.0) < cutoff:
                continue
            content = doc.get("chunk") or ""
            if content:
                chunks.append(content)
        return "\n\n".join(chunks)
    except Exception as e:
        print(f"[RAG Search Error] {e}")
        return ""

def build_prompt(context: str) -> str:
    """검색된 규정 문서(context)를 기반으로 few-shot 없는 프롬프트를 구성합니다."""
    return f"""당신은 게임 채팅 유해발언 심사역입니다. 당신의 개인적인 상식은 배제하고, 아래 제공된 [참조 규정 문서]의 기준만을 바탕으로 판단하세요.

[참조 규정 문서]
{context}

반드시 JSON 텍스트로만 답변하세요.
형식: {{"category_levels": {{"욕설강도": 정수, "음란성발언": 정수, "패드립": 정수, "폭력성발언": 정수}}, "auxiliary_tags": 문자열 배열, "urgent_flags": 문자열 배열, "final_level": 정수, "confidence": 0~1 사이 실수, "reason": "참조 규정 문서 내 어떤 조건과 대조했는지 기술"}}"""

async def analyze_chat(text: str) -> dict:
    if not client:
        return {"final_level": 0, "reason": "OpenAI client not configured"}

    # 1. RAG 기반 문맥 검색
    context = search_rag_documents(text)

    # 2. 동적 프롬프트 생성 및 OpenAI 호출
    try:
        kwargs = {
            "model": DEPLOYMENT_NAME,
            "messages": [
                {"role": "system", "content": build_prompt(context)},
                {"role": "user", "content": text}
            ],
        }
        # o1, o3 등 reasoning 계열 모델(혹은 프로젝트 헌법상의 gpt-5-mini)일 때만 reasoning_effort 적용
        if any(k in DEPLOYMENT_NAME.lower() for k in ["o1", "o3", "gpt-5"]):
            kwargs["reasoning_effort"] = "low"

        response = client.chat.completions.create(**kwargs)
        raw = (response.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = raw.strip("`").replace("json", "", 1).strip()
        
        return json.loads(raw)
    except BadRequestError as e:
        code = e.body.get("error", {}).get("code", "?") if hasattr(e, "body") else "?"
        print(f"[OpenAI BadRequestError] {code}")
        # Content Filter 등에 막히거나 API 에러 발생 시 HITL 수동 검토를 유도하기 위해 -1 반환
        return {"final_level": -1, "reason": f"Content Filter blocked: {code}"}
    except Exception as e:
        print(f"[OpenAI Error] {e}")
        return {"final_level": -1, "reason": f"Error during analysis: {e}"}
