import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

test('dashboard has requested summary metrics', () => {
  for (const label of ['오늘 접수', '대기 중', '처리 완료', '활성 제재']) {
    assert.match(html, new RegExp(label));
  }
});

test('dashboard has requested report queue columns', () => {
  for (const label of ['신고번호', '신고 일시', '신고자 ID', '피신고자 ID', '처리 결과']) {
    assert.match(html, new RegExp(label));
  }
});

test('dashboard has requested moderation tabs and filters', () => {
  for (const label of ['신고 내역', '제재 내역', '이의 신청', '전체 상태', '채팅 금지', '계정 정지']) {
    assert.match(html, new RegExp(label));
  }
});

test('transplanted admin dashboard has report review sheet fields', () => {
  for (const label of ['관리자 대시보드', '신고 내역', '제재 내역', '이의 신청']) {
    assert.match(html, new RegExp(label));
  }

  for (const label of ['신고 일시', '신고자 / 피신고자', '신고 내용', '제재 유형', '제재 기간', '처리 사유']) {
    assert.match(html, new RegExp(label));
  }

  assert.match(html, /id="sheetOverlay"/);
  assert.match(html, /id="sheetDurationDays"/);
});

test('transplanted dashboard shows actual reported messages in the sheet', () => {
  assert.match(script, /reported_message: '안녕하세요'/);
  assert.match(script, /sheetContent'\)\.textContent = report\.reported_message \|\| report\.content;/);
  assert.match(script, /alertContent'\)\.textContent = report\.reported_message \|\| report\.content;/);
});

test('transplanted dashboard removes separate detail action column', () => {
  assert.doesNotMatch(html, /<th>작업<\/th>/);
  assert.doesNotMatch(script, />상세<\/button>/);
});
