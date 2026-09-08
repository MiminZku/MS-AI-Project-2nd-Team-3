# 🛡️ AI 기반 실시간 게임 채팅·음성 제재 시스템
> **신고 기반 음성 STT, RAG 정책 조회 및 LLM 자동 판정을 결합한 지능형 게임 모더레이션 파이프라인**

[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Azure OpenAI](https://img.shields.io/badge/Azure_OpenAI-0078D4?style=flat-square&logo=microsoftazure)](https://azure.microsoft.com/)
[![Azure AI Speech](https://img.shields.io/badge/Azure_AI_Speech-0078D4?style=flat-square&logo=microsoftazure)](https://azure.microsoft.com/)
[![Azure AI Search](https://img.shields.io/badge/Azure_AI_Search-0078D4?style=flat-square&logo=microsoftazure)](https://azure.microsoft.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=flat-square&logo=postgresql)](https://www.postgresql.org/)
[![WebSocket](https://img.shields.io/badge/WebSocket-010101?style=flat-square&logo=socketdotio)](https://developer.mozilla.org/)

---

## 📌 프로젝트 개요 (Overview)

온라인 멀티플레이 게임 환경에서 발생하는 비속어, 성희롱, 패드립, 폭력성 발언 등 유해 행위를 신속하고 공정하게 제재하기 위한 **신고 기반 지능형 모더레이션 시스템**입니다.

기존의 단순 금칙어 기반 필터링은 변형 욕설을 탐지하기 어렵고, 모든 유저의 채팅/음성을 상시 감시하는 방식은 막대한 클라우드 비용과 프라이버시 침해 문제를 초래합니다. 본 프로젝트는 **"유저 신고 시에만 분석을 가동하는 온디맨드 파이프라인"**을 구축하여 비용 효율성을 극대화하고, 최신 운영 규정을 실시간 참조하는 **RAG(검색 증강 생성) 기반 LLM 심사 체계**와 **HITL(Human-In-The-Loop) 관리자 대시보드**를 결합했습니다.

---

## 🏗️ 시스템 아키텍처 (Architecture)

```mermaid
flowchart TD
    subgraph Client ["🎮 게임 클라이언트 (HTML5 / JS)"]
        User["이용자 A / B"]
        ReportBtn["신고 접수 (텍스트 / 음성 .wav)"]
        AppealUI["이의신청 인터페이스"]
    end

    subgraph Backend ["⚡ 게임 & 모더레이션 백엔드 (FastAPI / Node.js WebSocket)"]
        GameServer["게임 & 소켓 서버 (Port 3000)"]
        SanctionWorker["제재 집행기 (Mute / Kick)"]
    end

    subgraph Azure ["☁️ Azure AI 클라우드 파이프라인"]
        STT["Azure AI Speech (음성-텍스트 변환)"]
        Search["Azure AI Search (RAG 게임 운영 정책 DB)"]
        LLM["Azure OpenAI (gpt-4o-mini / gpt-5-mini)"]
    end

    subgraph Database ["🗄️ 저장소"]
        PG[("PostgreSQL\n(신고/제재/이의신청 내역)")]
        Storage[("음성 파일 저장소 (.wav)")]
    end

    subgraph Admin ["🖥️ 관리자 대시보드 (HITL)"]
        AdminUI["실시간 SSE 모니터링 큐"]
        AdminAction["수동 검토 / 제재 승인 / 이의신청 처리"]
    end

    User -->|채팅 및 음성 전송| GameServer
    User -->|부적절 발언 신고| ReportBtn
    ReportBtn -->|신고 이벤트 전달| GameServer

    GameServer -->|음성 파일 전달| STT
    STT -->|변환 텍스트 반환| GameServer

    GameServer -->|신고 텍스트 전달| LLM
    LLM <-->|관련 제재 규정 검색 및 반환| Search
    LLM -->|제재 수위 + 사유 안내문 산출| GameServer

    GameServer -->|고신뢰 자동 제재 집행| SanctionWorker
    SanctionWorker -->|실시간 Kick / Mute 명령| Client

    LLM -.->|저신뢰/복합 케이스| AdminUI
    AdminAction -->|수동 제재/기각 집행| GameServer

    GameServer -->|기록 저장| PG
    GameServer -->|음성 백업| Storage

    AppealUI -->|제재 이의제기 접수| AdminUI
```

---

## 💡 핵심 파이프라인 흐름 (Workflow)

1. **신고 접수**: 게임 내에서 유저가 텍스트 또는 음성 채팅을 신고 (음성은 `.wav` 파일 온디맨드 업로드).
2. **음성 인식 (STT)**: `Azure AI Speech`가 신고된 음성 녹음본을 정확한 한글 텍스트로 변환.
3. **RAG 정책 검색 & LLM 판정**:
   - 신고 문맥을 바탕으로 `Azure AI Search`에서 게임 운영 정책 규정(욕설 강도, 음란성, 패드립, 폭력성 등)을 하이브리드 검색.
   - `Azure OpenAI` 모델이 검색된 규정 지침에 근거하여 제재 레벨(Lv.0 ~ Lv.4), 신뢰도(Confidence), 안내 우편 내용을 JSON 형식으로 정밀 산출.
4. **즉시 제재 집행**: 게임 서버가 판정 결과에 따라 대상 유저를 실시간 채팅 금지(Mute) 또는 강제 퇴장(Kick) 조치.
5. **HITL 검토 및 이의신청**:
   - 신뢰도가 낮거나 심각한 사안은 관리자 대시보드로 자동 분기되어 관리자 수동 심사.
   - 유저의 오탐 신고(이의신청)에 대해 관리자가 음성 청취 및 원문 검토 후 제재 해제 지원.

---

## 🛠️ 기술 스택 (Tech Stack)

| 영역 | 사용 기술 | 설명 |
|---|---|---|
| **AI & Cloud** | **Azure OpenAI** | 유해 발언 심사 및 제재 레벨/안내문 자동 산출 (gpt-4o-mini / gpt-5-mini) |
| | **Azure AI Speech** | 신고된 유저 음성 녹음본 고정밀 음성 인식 (STT) |
| | **Azure AI Search** | 게임 운영 지침 및 제재 가이드라인 RAG 벡터/키워드 검색 인덱스 |
| **Backend** | **Python 3.11 / FastAPI** | 비동기 모더레이션 API 서버, SSE 스트리밍, AI 파이프라인 연동 |
| | **Node.js / ws** | 멀티플레이 실시간 세션 및 웹소켓 제재(Kick/Mute) 통제 |
| | **PostgreSQL / SQLAlchemy** | 신고 내역, 제재 히스토리, 이의신청 데이터 영속화 |
| **Frontend** | **Vanilla HTML5 / CSS / JS** | 2인 대전 사과게임 클라이언트, 실시간 음성/텍스트 채팅 및 신고 모달 |
| | **Admin Dashboard** | SSE 실시간 큐, 신고 필터링, 오디오 플레이어, 이의신청 심사 대시보드 |
| **DevOps & Tools** | **GitHub Actions** | 일일 업무 리포트 및 AI 아침 브리핑 자동화 파이프라인 |

---

## ✨ 주요 기능 (Key Features)

- **🎙️ 멀티모달(텍스트 + 음성) 신고 처리**:
  - Web Audio API 기반 음성 캡처 및 이벤트 트리거형 온디맨드 업로드 구조로 불필요한 트래픽 및 스토리지 낭비 방지.
- **⚖️ RAG 기반 4개 카테고리 5단계 제재 체계**:
  - 욕설 강도 / 음란성 발언 / 패드립 / 폭력성 발언 4개 영역 세분화 판정.
  - 최신 게임 운영 정책 DB 동적 조회를 통한 일관된 판정 근거 확보.
- **⚡ 실시간 WebSocket 제재 동기화**:
  - 판정 완료 즉시 게임 세션에서 대상 플레이어에게 제재 팝업 노출 및 실시간 킥/채팅 차단 집행.
- **👀 HITL(Human-In-The-Loop) 관리자 대시보드**:
  - SSE(Server-Sent Events) 기반 실시간 신고 대기열 모니터링.
  - 음성 파일 즉시 재생 기능, AI 판정 근거 및 신뢰도 시각화, 수동 제재 승인/기각.
- **📨 이의신청(Appeal) 처리 프로세스**:
  - 억울한 제재를 받은 유저를 위한 접수 폼 및 관리자 검토/제재 철회 파이프라인 지원.

---

## 📂 프로젝트 구조 (Directory Structure)

```text
MS-AI-Project-2nd-Team-3/
├── _backend/                 # FastAPI 백엔드 & AI 모더레이션 엔진
│   ├── main.py               # 백엔드 진입점 및 정적 파일 마운트
│   ├── database.py           # DB 커넥션 및 SQLAlchemy 세션 관리
│   ├── models.py             # DB ORM 모델 정의 (Reports, Sanctions 등)
│   ├── init.sql              # 초기 테이블 스키마 DDL
│   ├── routers/
│   │   ├── admin.py          # 관리자 대시보드 API (SSE, 제재/이의신청 관리)
│   │   └── game.py           # 게임 신고 접수 및 AI 제재 파이프라인 API
│   └── services/
│       ├── stt_logic.py      # Azure AI Speech STT 로직
│       ├── llm_logic.py      # Azure OpenAI & AI Search RAG 판정 로직
│       └── game_state.py     # 인메모리 게임 상태 및 웹소켓 연결 매니저
├── game_client/              # 2인 대전 사과게임 및 클라이언트 프론트엔드
│   ├── index.html            # 게임 및 채팅/신고 메인 화면
│   ├── server.js             # 웹소켓 통신 서버
│   ├── js/                   # 게임 로직, 채팅, 음성 녹음, 신고 모달 모듈
│   └── style.css             # 게임 및 UI 스타일시트
├── admin_frontend/           # 관리자 대시보드 및 이의신청 웹 인터페이스
│   ├── index.html            # 관리자 대시보드 메인
│   ├── app.js                # 대시보드 데이터 바인딩 및 SSE 이벤트 핸들러
│   ├── appeal.html           # 유저 이의신청 접수 페이지
│   └── styles.css            # 대시보드 스타일시트
├── moderation-poc/           # 모더레이션 알고리즘 및 프롬프트 PoC 테스트
│   ├── test_openai_moderation.py
│   ├── stt_pipeline_test.py
│   └── game_chat_categorized_FINAL.txt
├── docs/                     # 프로젝트 문서 및 아키텍처 정의서
│   ├── PROJECT.md            # 프로젝트 헌법 및 기술 명세
│   ├── decisions.md          # 아키텍처 결정 로그 (ADR)
│   └── plan.md               # 개발 마일스톤 및 로드맵
└── README.md
```

---

## 🚀 빠른 시작 가이드 (Getting Started)

### 1. 사전 요구사항
- Python 3.10+
- Node.js 18+
- PostgreSQL 15+
- Azure 리소스: Azure OpenAI, Azure AI Speech, Azure AI Search

### 2. 환경 변수 설정
`_backend/.env.example`을 복사하여 `_backend/.env` 파일을 생성하고 키를 입력합니다:

```env
# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/apple_game

# Azure OpenAI
AZURE_OPENAI_KEY=your_azure_openai_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-02-15-preview

# Azure AI Search (RAG)
AZURE_SEARCH_ENDPOINT=https://your-search-service.search.windows.net
AZURE_SEARCH_KEY=your_azure_search_key
AZURE_SEARCH_INDEX_NAME=game-policy-index

# Azure AI Speech (STT)
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=koreacentral
```

### 3. 데이터베이스 초기화
PostgreSQL에 `apple_game` 데이터베이스를 생성하고 DDL을 적용합니다:
```bash
psql -U postgres -d apple_game -f _backend/init.sql
```

### 4. 백엔드 실행
```bash
cd _backend
pip install -r requirements.txt
python main.py
# -> http://localhost:3000 에서 게임 및 API가 실행됩니다.
```

### 5. 게임 클라이언트 및 관리자 대시보드 접속
- **게임 플레이 & 신고 테스트**: 브라우저에서 `http://localhost:3000` 접속
- **관리자 대시보드**: `admin_frontend/index.html` 파일을 브라우저로 열어 접속 (`admin01` / `admin1234`)
