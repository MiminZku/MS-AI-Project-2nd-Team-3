import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./appeal.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('./appeal.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('./appeal.js', import.meta.url), 'utf8');

test('appeal page has user-facing appeal form fields', () => {
  for (const label of ['이의신청 접수', '신청자 ID', '신고번호 또는 제재번호', '이메일', '이의신청 사유', '추가 설명']) {
    assert.match(html, new RegExp(label));
  }

  for (const id of ['userId', 'caseId', 'email', 'appealReason', 'appealDetail', 'appealForm']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('appeal page uses a bright visual theme', () => {
  assert.match(css, /--page:\s*#f6f8fc/);
  assert.match(css, /--card:\s*#ffffff/);
  assert.match(css, /--accent:\s*#2563eb/);
  assert.doesNotMatch(css, /#07111f|#0f1c2f|#050b16/);
});

test('appeal page validates required fields and shows completion state', () => {
  assert.match(script, /const requiredFields = \['userId', 'caseId', 'email', 'appealReason', 'appealDetail'\]/);
  assert.match(script, /접수가 완료되었습니다/);
  assert.match(script, /누락된 항목을 입력해 주세요/);
});
