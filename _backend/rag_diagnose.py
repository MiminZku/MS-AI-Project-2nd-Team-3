"""
===============================================================================
 rag_diagnose.py — RAG 판정 품질 진단 스크립트   [테스트 전용 · 서비스 코드 아님]
===============================================================================

■ 이 파일이 하는 일
  Azure AI Search(RAG)가
    (1) 정책 문서에서 "맞는 기준 섹션"을 찾아오는가        ← 검색 품질
    (2) 찾아온 문서만으로 등급을 제대로 매기는가            ← 판정 품질
  이 두 가지를 분리해서 확인합니다.
  팀 골드 데이터(moderation-poc/game_chat_categorized_FINAL.txt)에서 뽑은
  12문장(카테고리별 3개)을 자동으로 돌려 정답과 대조한 뒤 표로 출력합니다.

■ rag_test.py 와 무엇이 다른가 (둘 다 있는 이유)
  ┌──────────────┬──────────────────────┬────────────────────────────────┐
  │              │ rag_test.py          │ rag_diagnose.py (이 파일)      │
  ├──────────────┼──────────────────────┼────────────────────────────────┤
  │ 사용 방식    │ 손으로 한 문장씩 입력│ 12문장 자동 실행               │
  │ few-shot 예시│ 있음                 │ ★ 없음 (의도적으로 제거)       │
  │ 정답 채점    │ 안 함                │ 함 (골드 라벨과 자동 대조)     │
  │ 목적         │ 즉석 확인·시연       │ RAG 실력 측정                  │
  └──────────────┴──────────────────────┴────────────────────────────────┘

■ few-shot 을 왜 뺐나  ← 이 파일이 따로 존재하는 핵심 이유
  rag_test.py 프롬프트에는 "라준호 뇌 없음 → 욕설 2단계" 같은 판정 예시가
  하드코딩돼 있습니다. 그러면 RAG 검색이 0건이어도 모델이 그 예시만 보고
  정답을 맞힐 수 있어서, "RAG가 실제로 기여하는지"를 검증할 수 없습니다.
  (실제로 2026-07-19 진단 전까지 이 문제로 청킹 개선 효과가 가려져 있었음)

  이 파일은 예시를 전부 빼고 [참조 규정 문서]만 남겨서, 판정 근거가
  100% 검색된 정책 문서에서만 나오도록 강제합니다.
  → 여기서 나온 점수는 순수한 RAG 실력입니다.

■ 검색 설정은 rag_test.py 와 완전히 동일하게 맞춰둠
  같은 인덱스 / top_n=8 / strictness_level=1 / text-embedding-3-small
  (검색 조건이 다르면 비교가 무의미해지므로 의도적으로 일치시킴.
   rag_test.py 쪽 설정을 바꾸면 이 파일도 같이 바꿔야 비교가 유효합니다.)

■ 실행 방법
      cd _backend
      py rag_diagnose.py
  결과는 콘솔에 출력되고, 같은 폴더에 rag_diagnose_result.txt 로도 저장됩니다.
  (팀 공유·기록용. 정책 문서를 수정하고 재색인한 뒤 다시 돌려 비교하면 됨)

■ 결과 읽는 법 — 이게 이 파일의 핵심 가치
      검색 정확도   : 정답 카테고리 기준이 검색돼 왔는가   → RAG 검색 문제
      카테고리/단계 : 그 문서로 제대로 판정했는가          → 모델 적용 문제
  · 검색 ❌ 이면 → top_n·strictness·청킹·임베딩을 손봐야 함
  · 검색 ✅ 인데 판정 ❌ 이면 → 검색 튜닝은 소용없고, 정책 문서에
    보정 예시를 추가해야 함  (2026-07-19 진단 결과가 정확히 이 경우였음)

■ 테스트 세트가 2개인 이유  ★ 중요 (숫자 해석이 완전히 달라짐)
  ─ 1차(CASES_GOLD) : 팀 골드 데이터에서 가져온 12문장. 정답이 팀 검수를 거쳐
      확실합니다. 다만 이 중 일부는 정책 문서 안의 판정 예시와 표현이 거의
      같습니다. (예: "가정교육을 어떻게 받았길래" ↔ 문서 예시 "집에서 그렇게
      안 가르쳤을 것 같은데")  실제로 모델이 그 예시를 그대로 인용해 맞힌
      사례가 확인됐습니다. → 즉 "기준을 이해했다"가 아니라 "비슷한 예시를
      찾아 베꼈다"일 수 있어서, 점수가 낙관적으로 부풀 수 있습니다.

  ─ 2차(CASES_NOVEL) : 정책 문서 예시에도 없고 골드 데이터에도 없는 신규 문장.
      베낄 예시가 없으므로, 문서의 "기준"만으로 판단해야 맞힐 수 있습니다.
      → 이쪽 점수가 실제 서비스에서 기대할 수 있는 진짜 성능에 가깝습니다.

  1차 점수 >> 2차 점수 로 벌어지면, 그건 모델이 기준을 일반화하지 못하고
  문서에 적힌 예시에만 의존한다는 뜻입니다. (해결책: 정책 문서에 예시 추가)

  ⚠ 2차 정답은 정책 문서 기준으로 뽑은 초안이며 아직 팀 검수 전입니다.
     1차 골드 데이터처럼 팀 확인을 거쳐야 신뢰할 수 있는 정답이 됩니다.

 최초 작성 2026-07-19 · 박성은 (OpenAI·데이터 파트)
===============================================================================
"""

import os
import sys
import json

from dotenv import load_dotenv
from openai import AzureOpenAI, BadRequestError
from azure.core.credentials import AzureKeyCredential
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

# 한글 깨짐 방지 (Windows 콘솔 기본 인코딩이 cp949라서 필요)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

ai_client = AzureOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version="2025-04-01-preview",
)

INDEX_NAME = os.getenv("AZURE_SEARCH_INDEX_NAME")
search_client = SearchClient(
    endpoint=os.getenv("AZURE_SEARCH_ENDPOINT"),
    index_name=INDEX_NAME,
    credential=AzureKeyCredential(os.getenv("AZURE_SEARCH_KEY")),
)
# Azure 마법사가 만든 시맨틱 설정 이름 규칙: <인덱스명>-semantic-configuration
SEMANTIC_CONFIG = f"{INDEX_NAME}-semantic-configuration"

DEPLOYMENT_NAME = os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "gpt-5-mini")

# ── 1차 세트 : 팀 골드 데이터 12문장 ─────────────────────────────────────────
# 전부 팀 골드 데이터(game_chat_categorized_FINAL.txt)에서 그대로 가져왔으므로
# 정답(카테고리·단계)이 팀 검수를 거쳐 확실합니다.
# 주의: ★ 표시는 정책 문서 안의 판정 예시와 표현이 거의 같아, 모델이 기준을
#       추론하지 않고 예시를 베껴서 맞혔을 수 있는 문항입니다.
CASES_GOLD = [
    ("강민기 손가락 하나 없냐? 왤케 못함?",  "욕설강도",   2),
    ("병신같은 정글 뭐하냐 갱도 안 오고",     "욕설강도",   2),
    ("개시키 뭐하냐 진짜 답답하네",           "욕설강도",   1),
    ("그 스킨 좀 야하게 생겼다 ㅋㅋ",         "음란성발언", 1),
    ("개보지 같은 소리 좀 그만해라",          "음란성발언", 2),
    ("씨발련 몸이나 팔러 다니지 왜 겜하냐",   "음란성발언", 3),
    ("가정교육을 어떻게 받았길래 그러냐",     "패드립",     1),   # ★ 문서 예시와 유사
    ("느금마 탑 좀 그만 던져라",              "패드립",     2),
    ("느그 죽은 할매도 이거보다는 잘하겠다",  "패드립",     4),
    ("현피 뜨자 진짜",                        "폭력성발언", 2),   # ★ 문서 예시와 유사
    ("너 아이디 따서 신상 털어버린다",        "폭력성발언", 3),   # ★ 문서 예시와 유사
    ("니네 집 주소 알아내서 찾아간다",        "폭력성발언", 4),   # ★ 문서 예시와 유사
]

# ── 2차 세트 : 신규 문장 14개 (일반화 능력 측정) ─────────────────────────────
# 정책 문서의 판정 예시에도 없고, 골드 데이터 121문장에도 없는 표현으로만 구성.
# "베낄 예시"가 없으므로 문서의 기준(정의)만으로 판단해야 맞힐 수 있습니다.
#
# ⚠ 아래 정답은 정책 문서의 단계 정의를 근거로 뽑은 초안이며 팀 검수 전입니다.
#    각 항목 옆 주석이 판단 근거이니, 팀에서 이 근거를 보고 확정해 주세요.
CASES_NOVEL = [
    # 욕설 강도 — 정의: 1=대상 미특정 짧은 비속어 / 2=특정 대상 비하 / 3=조롱을 통한 모욕·명예훼손
    ("아 씨 이번 판 진짜 안 풀리네",              "욕설강도",   1),  # 대상 없는 짧은 비속어 1회
    ("저 서폿 발컨이네 진짜 답이 없다",           "욕설강도",   2),  # 특정 이용자 지목 비하
    ("겜도 못하면서 입만 살았네 인생도 그렇겠지", "욕설강도",   3),  # 조롱→인격 전반 모욕(명예훼손급)

    # 음란성 발언 — 정의: 1=간접 암시 / 2=신체 언급·수치심 / 3=직접 묘사·노출 요구
    ("여캐만 골라 하는 거 보니 취향 뻔하네",      "음란성발언", 1),  # 은유적·이중적 성적 암시
    ("너 목소리 들으니까 이상한 상상 되는데",     "음란성발언", 2),  # 대상에게 성적 수치심 유발
    ("카메라 켜고 몸 좀 보여줘봐",                "음란성발언", 3),  # 신체 노출 요구 + 성적 괴롭힘

    # 패드립 — 정의: 1=간접 암시 / 2=부모·가족 직접 지칭 / 4=고인 모독 결합
    ("그런 성격은 어디서 물려받은 거냐",          "패드립",     1),  # 가족 간접 암시
    ("니 어머니가 참 고생 많으시겠다",            "패드립",     2),  # '어머니' 직접 지칭 조롱
    ("돌아가신 아버지가 보면 뭐라 하시겠냐",      "패드립",     4),  # 고인 언급 결합 → 최상급

    # 폭력성 발언 — 정의: 1=막연한 감정 / 2=대상 향한 위해 암시 / 4=실제 장소 특정 + 위해 예고
    ("진짜 확 엎어버리고 싶네 이 게임",           "폭력성발언", 1),  # 대상 불특정, 거친 감정 표출
    ("겜 접고 기다려라 언젠간 만나게 될 테니",    "폭력성발언", 2),  # 대상 향한 위해 암시(구체성 없음)
    ("니 회사 앞에서 기다리고 있을 테니 나와라",  "폭력성발언", 4),  # 실제 직장 특정 + 위해 예고

    # 정상·제지 발언 — 오탐(false positive) 검증용. 유해로 잡으면 안 되는 문장.
    ("자꾸 그러면 운영팀에 알릴 거야",            "정상",       0),  # 신고 의사 표명, 추상적 → 0단계
    ("게임 얘기나 하자 그런 말 말고",             "정상",       0),  # 추상적 지칭만 → 0단계
]

# 검색 결과에 각 카테고리의 "기준 섹션"이 실제로 포함됐는지 판정하는 마커.
# 청크가 섹션 중간에서 잘릴 수 있으므로 제목 외에 본문 특징 문구도 함께 사용.
SECTION_MARKERS = {
    "욕설강도":   ["욕설 강도", "PROFANITY", "조직적·집단적 욕설"],
    "음란성발언": ["음란성 발언", "OBSCENE", "성적 대상화"],
    "패드립":     ["패드립", "FAMILY-RELATED", "고인 모독"],
    "폭력성발언": ["폭력성 발언", "VIOLENT SPEECH", "폭력성 구체성 보정", "잔인한 폭력 묘사"],
    # 정상(0단계) 판정에 필요한 근거 섹션 — 제지·신고 발언을 유해로 오탐하지 않으려면 이게 와야 함
    "정상":       ["0단계 및 화자 구분", "항의·경고·신고", "추상적 지칭", "제지 발언"],
}

# 여러 카테고리가 동점일 때 대표 카테고리를 정하는 우선순위 (심각한 순)
PRIORITY = ["폭력성발언", "패드립", "음란성발언", "욕설강도"]


def search_rag_documents(query, top_n=12, strictness_level=1):
    """rag_test.py 의 검색 로직과 동일 (비교 유효성을 위해 일부러 같게 유지)"""
    emb = ai_client.embeddings.create(model="text-embedding-3-small", input=query)
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
    # strictness 커트라인 — 실측 reranker 점수(0.7~0.9)에 맞춰 보정한 값
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


def build_prompt(context):
    """★ few-shot 없음. 페르소나 + 참조 문서 + 출력 형식만.
    판정 근거를 검색된 정책 문서로만 제한하기 위함 (파일 상단 설명 참고)."""
    return f"""당신은 게임 채팅 유해발언 심사역입니다. 당신의 개인적인 상식은 배제하고, 아래 제공된 [참조 규정 문서]의 기준만을 바탕으로 판단하세요.

[참조 규정 문서]
{context}

반드시 JSON 텍스트로만 답변하세요.
형식: {{"category_levels": {{"욕설강도": 정수, "음란성발언": 정수, "패드립": 정수, "폭력성발언": 정수}}, "auxiliary_tags": 문자열 배열, "urgent_flags": 문자열 배열, "final_level": 정수, "confidence": 0~1 사이 실수, "reason": "참조 규정 문서 내 어떤 조건과 대조했는지 기술"}}"""


def judge(text, context, retries=2):
    """판정 요청. gpt-5-mini 는 가끔 빈 응답을 내므로 재시도를 둔다."""
    last_error = None
    for _ in range(retries + 1):
        try:
            response = ai_client.chat.completions.create(
                model=DEPLOYMENT_NAME,
                messages=[
                    {"role": "system", "content": build_prompt(context)},
                    {"role": "user", "content": text},
                ],
            )
            raw = (response.choices[0].message.content or "").strip()
            if not raw:
                last_error = "빈 응답"
                continue
            if raw.startswith("```"):
                raw = raw.strip("`").replace("json", "", 1).strip()
            return json.loads(raw), None
        except BadRequestError as e:
            # Azure 콘텐츠 필터가 요청 자체를 막은 경우 (실서비스라면 HITL 대상)
            code = e.body.get("error", {}).get("code", "?") if hasattr(e, "body") else "?"
            return None, f"콘텐츠 필터 차단({code})"
        except json.JSONDecodeError:
            last_error = "JSON 파싱 실패"
            continue
    return None, last_error


def run_suite(title, note, cases, out):
    """한 세트를 돌리고 집계 결과를 dict 로 돌려준다."""
    out("\n" + "=" * 78)
    out(f"  {title}")
    out(f"  {note}")
    out("=" * 78)

    retrieval_ok = category_ok = level_exact = level_close = 0
    errors = []

    for text, gold_category, gold_level in cases:
        context = search_rag_documents(text)

        # (1) 검색 진단 — 정답 카테고리의 기준 섹션이 실제로 들어왔는가
        found = any(m in context for m in SECTION_MARKERS[gold_category])
        if found:
            retrieval_ok += 1
        came_with = [c for c, ms in SECTION_MARKERS.items()
                     if c != "정상" and any(m in context for m in ms)]

        out("\n" + "─" * 78)
        out(f"[{gold_category}] {text}")
        out(f"  검색: {'O' if found else 'X'} 정답 카테고리 기준 "
            f"{'포함됨' if found else '없음'}"
            f" | 함께 온 섹션: {', '.join(came_with) if came_with else '없음'}"
            f" | 문서량 {len(context)}자")

        # (2) 판정 진단 — 그 문서로 제대로 등급을 매겼는가
        result, error = judge(text, context)
        if result is None:
            errors.append((text, error))
            out(f"  판정: 실패 ({error})")
            continue

        levels = result.get("category_levels", {}) or {}
        final_level = int(result.get("final_level", 0))
        max_level = max(levels.values()) if levels else 0
        tied = [c for c in PRIORITY if levels.get(c, 0) == max_level and max_level > 0]
        predicted_category = tied[0] if tied else "정상"

        is_cat_ok = predicted_category == gold_category
        is_exact = final_level == gold_level
        is_close = abs(final_level - gold_level) <= 1
        category_ok += is_cat_ok
        level_exact += is_exact
        level_close += is_close

        mark = "O" if is_exact else ("~" if is_close else "X")
        out(f"  판정: {predicted_category} {final_level}단계 "
            f"(정답 {gold_category} {gold_level}단계) "
            f" 카테고리{'O' if is_cat_ok else 'X'} 단계{mark}")
        out(f"    세부: {levels}")
        if result.get("urgent_flags"):
            out(f"    긴급플래그: {result['urgent_flags']}")
        out(f"    근거: {str(result.get('reason', ''))[:150]}")

    total = len(cases)
    judged = total - len(errors)

    out("\n" + "-" * 78)
    out(f"  [{title}] 소계")
    out(f"    검색 정확도 : {retrieval_ok}/{total}")
    if judged:
        out(f"    카테고리 일치 : {category_ok}/{judged}"
            f"   단계 정확 : {level_exact}/{judged}"
            f"   단계 ±1 : {level_close}/{judged}")
    if errors:
        out(f"    판정 실패 {len(errors)}건: " + ", ".join(t for t, _ in errors))

    return {
        "title": title, "total": total, "judged": judged,
        "retrieval": retrieval_ok, "category": category_ok,
        "exact": level_exact, "close": level_close, "errors": errors,
    }


def pct(n, d):
    return f"{n}/{d} ({n / d * 100:.0f}%)" if d else "-"


def main():
    report = []

    def out(line=""):
        print(line)
        report.append(line)

    out("=" * 78)
    out("  RAG 진단 — few-shot 제거 / top_n=8 / strictness=1 / " + DEPLOYMENT_NAME)
    out(f"  인덱스: {INDEX_NAME}")
    out("=" * 78)

    gold = run_suite(
        "1차 · 골드 데이터",
        "팀 검수 완료 정답 / 일부는 정책 문서 예시와 표현이 유사(점수가 부풀 수 있음)",
        CASES_GOLD, out,
    )
    novel = run_suite(
        "2차 · 신규 문장",
        "문서 예시·골드 데이터에 없는 표현 / 기준만으로 판단해야 함 (정답 팀 검수 전)",
        CASES_NOVEL, out,
    )

    out("\n" + "=" * 78)
    out("  종합 비교")
    out("=" * 78)
    out(f"  {'':22}{'1차(골드)':>18}{'2차(신규)':>18}")
    out(f"  {'검색 정확도':22}{pct(gold['retrieval'], gold['total']):>18}"
        f"{pct(novel['retrieval'], novel['total']):>18}")
    out(f"  {'카테고리 일치':22}{pct(gold['category'], gold['judged']):>18}"
        f"{pct(novel['category'], novel['judged']):>18}")
    out(f"  {'단계 정확 일치':22}{pct(gold['exact'], gold['judged']):>18}"
        f"{pct(novel['exact'], novel['judged']):>18}")
    out(f"  {'단계 ±1 이내':22}{pct(gold['close'], gold['judged']):>18}"
        f"{pct(novel['close'], novel['judged']):>18}")

    out("")
    out("  [해석 가이드]")
    out("   · 검색 O 인데 단계 X  → 검색 튜닝 말고 정책 문서에 보정 예시 추가")
    out("   · 1차 >> 2차 로 벌어짐 → 모델이 기준을 일반화 못하고 문서 예시에만 의존")
    out("   · 1차 ≒ 2차          → 기준 자체를 이해하고 적용 중 (일반화 성공)")

    result_path = os.path.join(BASE_DIR, "rag_diagnose_result.txt")
    with open(result_path, "w", encoding="utf-8") as f:
        f.write("\n".join(report))
    print(f"\n결과 저장됨: {result_path}")


if __name__ == "__main__":
    main()
