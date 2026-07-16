import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const html = readFileSync(new URL('./admin_dashboard.html', import.meta.url), 'utf8');

test('admin dashboard is a standalone html file', () => {
  assert.match(html, /<style>/);
  assert.match(html, /<script>/);
  assert.doesNotMatch(html, /admin_dashboard\.css/);
  assert.doesNotMatch(html, /js\/admin_dashboard\.js/);
});

test('admin dashboard has requested summary metrics', () => {
  for (const label of ['오늘 신규 신고', '미처리 신고', '고위험 신고', '평균 처리 시간', '제재율']) {
    assert.match(html, new RegExp(label));
  }
});

test('admin dashboard has report queue columns', () => {
  for (const label of ['신고 ID', '신고 대상 플레이어', '신고 사유', '게임/모드', 'AI 위험도', '신고 횟수', '상태', '담당자']) {
    assert.match(html, new RegExp(label));
  }
});

test('admin dashboard has detail sections and sanction buttons', () => {
  for (const label of ['채팅 로그 / 게임 기록', '신고자·피신고자 정보', '과거 제재 이력', '유해발언 카테고리', '심각도', '증거 자료']) {
    assert.match(html, new RegExp(label));
  }

  for (const label of ['경고', '채팅 제한', '게임 제한', '영구 정지']) {
    assert.match(html, new RegExp(label));
  }
});

test('inline script has valid JavaScript syntax', async () => {
  const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(script);

  const tempScript = join(tmpdir(), 'admin-dashboard-inline-check.js');
  writeFileSync(tempScript, script, 'utf8');

  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--check', tempScript], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
