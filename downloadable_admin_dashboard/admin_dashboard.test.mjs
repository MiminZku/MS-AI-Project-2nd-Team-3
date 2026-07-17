import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const html = readFileSync(new URL('./admin_dashboard.html', import.meta.url), 'utf8');

test('downloadable admin dashboard is standalone html', () => {
  assert.match(html, /<style>/);
  assert.match(html, /<script>/);
});

test('downloadable admin dashboard has operator dashboard sections', () => {
  for (const label of ['운영자 로그인', '오늘 신규 신고', '미처리 신고', '고위험 신고', '평균 처리 시간', '제재율', '신고 큐']) {
    assert.match(html, new RegExp(label));
  }
});

test('downloadable admin dashboard has detail and sanction controls', () => {
  for (const label of ['채팅 로그 / 게임 기록', '신고자·피신고자 정보', '과거 제재 이력', '유해발언 카테고리', '증거 자료']) {
    assert.match(html, new RegExp(label));
  }

  for (const label of ['경고', '채팅 제한', '게임 제한', '영구 정지']) {
    assert.match(html, new RegExp(label));
  }
});

test('downloadable admin dashboard inline script is valid', async () => {
  const script = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(script);

  const tempScript = join(tmpdir(), 'downloadable-admin-dashboard-check.js');
  writeFileSync(tempScript, script, 'utf8');

  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['--check', tempScript], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
