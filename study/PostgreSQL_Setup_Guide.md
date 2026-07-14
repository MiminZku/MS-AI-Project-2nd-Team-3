# 🐘 Windows PostgreSQL 로컬 설치 및 협업 연동 종합 가이드

이 문서는 로컬 Windows PC에 PostgreSQL을 직접 설치하고, 데이터베이스 스키마 생성 및 같은 와이파이(내부망) 내 팀원들에게 안전하게 공유하는 전체 세팅 과정을 기록한 가이드라인입니다.

---

## 📌 목차
1. [PostgreSQL 설치](#1-postgresql-설치)
2. [데이터베이스 및 테이블 스키마 구성](#2-데이터베이스-및-테이블-스키마-구성)
3. [외부 협업 공유 설정 (보안 인증 유지)](#3-외부-협업-공유-설정-보안-인증-유지)
4. [Windows 방화벽 포트 개방](#4-windows-방화벽-포트-개방)
5. [백엔드 연동 및 작동 테스트](#5-백엔드-연동-및-작동-테스트)

---

## 1. PostgreSQL 설치

1. **인스톨러 다운로드**
   * [PostgreSQL 공식 다운로드 페이지](https://www.postgresql.org/download/windows/)에 접속합니다.
   * **"Download the installer"** 버튼을 클릭한 후, 원하는 버전(추천: 15 또는 16 버전)의 Windows용 인스톨러를 다운로드합니다.

2. **설치 프로세스 진행**
   * 다운로드한 `.exe` 파일을 실행합니다.
   * **Select Components**: 기본값 그대로 전체 체크된 상태로 진행합니다. (`pgAdmin 4`가 포함되어 있어야 GUI로 조작하기 편리합니다.)
   * **Password**: 데이터베이스 관리자(`postgres`)의 비밀번호를 설정합니다. **(⚠️ 백엔드 연동에 쓰이므로 반드시 기억해 두세요.)**
   * **Port**: 기본값인 **`5432`**를 유지합니다.
   * **Advanced Options**: Locale은 기본값 `[Default locale]`을 권장합니다.

3. **Stack Builder 체크 해제**
   * 설치 마지막 단계에서 `Launch Stack Builder at exit?` 체크박스가 나타납니다.
   * **체크를 해제**하고 **Finish**를 눌러 종료합니다. (추가 부가 플러그인 설치 도구이며, 본 프로젝트에는 불필요합니다.)

---

## 2. 데이터베이스 및 테이블 스키마 구성

1. **pgAdmin 4 실행 및 로그인**
   * Windows 시작 메뉴에서 `pgAdmin 4`를 검색해 실행합니다.
   * 접속 패스워드를 묻는 창이 나오면 설치할 때 지정했던 비밀번호를 입력합니다.
   * 좌측 `Servers` > `PostgreSQL (버전)`을 클릭하여 연결합니다.

2. **데이터베이스 생성**
   * `Databases` 항목을 마우스 우클릭한 후 **Create > Database...** 를 선택합니다.
   * Database 이름 입력란에 **`apple_game`**을 입력하고 하단의 **Save**를 누릅니다.

3. **테이블 스키마(DDL) 적용**
   * 새로 생성된 `apple_game` 데이터베이스를 마우스 우클릭하고 **Query Tool**을 클릭합니다.
   * 우측 쿼리 입력 창에 프로젝트 내의 [init.sql](file:///c:/Project/MS-AI-Project-2nd-Team-3/_backend/init.sql) 내용 전체를 복사하여 붙여넣습니다.
   * 상단 도구 모음의 **재생 버튼(▶)**을 클릭하거나 **`F5`** 키를 눌러 실행합니다.
   * 하단 Messages 창에 `Query returned successfully` 문구가 뜨면 테이블 생성이 완료된 것입니다.

---

## 3. 외부 협업 공유 설정 (보안 인증 유지)

같은 와이파이(내부망)를 사용하는 다른 팀원들이 비밀번호 보안을 유지하며 질문자님 PC의 DB 서버에 접속하도록 설정합니다.

1. **설정 파일 경로 이동**
   * `C:\Program Files\PostgreSQL\(설치한버전)\data` 폴더로 이동합니다.

2. **`postgresql.conf` 수정 (수신 주소 개방)**
   * `postgresql.conf` 파일을 메모장(관리자 권한)으로 엽니다.
   * `#listen_addresses = 'localhost'` 부분을 찾아 주석 기호 `#`을 지우고, 값을 `'*'`로 변경합니다.
     ```ini
     listen_addresses = '*'
     ```
   * 파일을 저장하고 닫습니다.

3. **`pg_hba.conf` 수정 (보안 패스워드 인증 적용)**
   * `pg_hba.conf` 파일을 메모장(관리자 권한)으로 엽니다.
   * 파일 맨 아래쪽으로 이동하여 다음 한 줄을 추가합니다.
     ```text
     # IP 통로는 열어두되, 반드시 안전한 비밀번호(scram-sha-256) 검증을 거치게 설정
     host    all             all             0.0.0.0/0               scram-sha-256
     ```
     > [!IMPORTANT]
     > `0.0.0.0/0`은 모든 IP로부터의 통로를 열어주지만, 보안 수단으로 `scram-sha-256`이 명시되어 있기 때문에 **올바른 비밀번호를 입력하지 않으면 접속이 절대 불가**합니다.
   * 파일을 저장하고 닫습니다.

4. **PostgreSQL 서비스 재시작 (필수)**
   * Windows 검색창에 `서비스` (또는 `services.msc`)를 입력해 실행합니다.
   * 목록에서 **`postgresql-x64-(버전)`**을 찾습니다.
   * 마우스 우클릭한 후 **재시작(Restart)**을 클릭합니다.

---

## 4. Windows 방화벽 포트 개방

외부 기기에서 포트 5432를 통해 들어오는 네트워크 요청을 윈도우 방화벽이 차단하지 않도록 차단 해제 규칙을 만듭니다.

1. Windows 검색창에 `PowerShell`을 입력한 뒤 **관리자 권한으로 실행**합니다.
2. 아래 명령어를 복사하여 실행합니다.
   ```powershell
   New-NetFirewallRule -DisplayName "PostgreSQL Port 5432" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5432
   ```

---

## 5. 백엔드 연동 및 작동 테스트

### ① 로컬 환경 설정 파일 작성 (`.env`)
`_backend` 폴더 내에 `.env` 파일을 새로 만들고(보안상 Git 커밋 금지), DB 커넥션 DSN 주소를 적어줍니다.

* **DB 소유자 (질문자님) `.env`:**
  ```env
  DATABASE_URL=postgresql://postgres:설정한비밀번호@localhost:5432/apple_game
  ```
* **동일 와이파이 내 팀원 `.env`:**
  ```env
  DATABASE_URL=postgresql://postgres:설정한비밀번호@<질문자님내부IP>:5432/apple_game
  ```
  *(예: `DATABASE_URL=postgresql://postgres:Rktmghkfaudtn1897##@172.16.30.143:5432/apple_game`)*

### ② 라이브러리 설치 및 테스트 실행
터미널에서 `_backend` 디렉토리로 이동하여 의존성 패키지를 설치하고 테스트 코드를 실행합니다.

```bash
# 필수 라이브러리 설치
pip install psycopg2-binary python-dotenv

# 테스트 실행
python test_db.py
```

`test_db.py` 실행 결과 모든 테이블에 대해 정상적으로 `SELECT *`가 진행되고 에러 없이 조회가 완료되면 로컬 연동이 완료된 것입니다.
