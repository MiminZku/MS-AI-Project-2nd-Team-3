-- Initial Database Schema for Apple Game AI Sanction Pipeline

-- 1. Users Table (유저)
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    is_muted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Admins Table (관리자)
CREATE TABLE IF NOT EXISTS admins (
    id VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL, -- 해싱된 비밀번호 저장 권장
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Reports Table (신고 내역)
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reporter_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    reported_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'PENDING', -- PENDING (대기), COMPLETED (처리 완료), MANUAL_REVIEW_REQUIRED (AI 판단 불가/인간 심사 필요)
    content_type VARCHAR(20), -- TEXT, VOICE 등
    content_path TEXT, -- 음성 파일 경로 또는 채팅 내용 텍스트
    CONSTRAINT chk_reporter_reported CHECK (reporter_id <> reported_id)
);

-- 4. Sanctions Table (제재 내역)
CREATE TABLE IF NOT EXISTS sanctions (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    ai_result TEXT, -- AI 추론 결과 (예: '욕설 3단계', '이상 탐지') 또는 콘텐츠 필터 에러 기록
    type VARCHAR(50) NOT NULL, -- MUTE (채팅 금지), BAN (계정 정지)
    duration_days INTEGER NOT NULL, -- 제재 기간 (n일)
    ended_at TIMESTAMP WITH TIME ZONE -- 제재 만료 일시 (NULL이면 영구 혹은 수동 해제 필요)
);

-- 5. Appeals Table (이의 신청)
CREATE TABLE IF NOT EXISTS appeals (
    id SERIAL PRIMARY KEY,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    user_id VARCHAR(50) REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, APPROVED (인용/해제), REJECTED (기각)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 초기 더미 데이터 삽입 (필요시 활성화/참고)
-- INSERT INTO users (id, is_muted) VALUES ('user1', false), ('user2', false), ('user3', false);
-- INSERT INTO admins (id, password) VALUES ('admin', 'admin123'); -- 테스트용 평문 혹은 해시
