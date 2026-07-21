import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const adminRouter = readFileSync(new URL('../_backend/routers/admin.py', import.meta.url), 'utf8');
const gameRouter = readFileSync(new URL('../_backend/routers/game.py', import.meta.url), 'utf8');
const backendMain = readFileSync(new URL('../_backend/main.py', import.meta.url), 'utf8');

test('dashboard keeps the core report, sanction, and appeal tables', () => {
  for (const id of ['reportBody', 'sanctionBody', 'appealBody']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('dashboard keeps the report review sheet controls', () => {
  for (const id of ['sheetOverlay', 'sheetReportTime', 'sheetUsers', 'sheetContent', 'sheetAudioRow', 'sheetAudio', 'sheetAudioLink', 'sheetAudioStatus', 'sheetSanctionType', 'sheetDurationDays', 'sheetReason']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('dashboard shows report type and sorting controls in report history', () => {
  assert.match(html, /<th>신고 유형<\/th>/);
  assert.match(html, /id="reportSort"/);
  assert.match(html, /value="latest"/);
  assert.match(html, /value="oldest"/);
  assert.match(script, /function contentTypeLabel\(type\)/);
  assert.match(script, /contentTypeLabel\(report\.content_type\)/);
  assert.match(script, /const sort = byId\('reportSort'\)\.value;/);
  assert.match(script, /rows\.sort\(\(a, b\) =>/);
});

test('dashboard loads full history data from backend admin APIs', () => {
  assert.match(script, /function apiUrl\(path\)/);
  assert.match(script, /http:\/\/172\.16\.30\.143:3000/);
  assert.doesNotMatch(script, /localhost:3000/);
  assert.match(script, /requestJson\(['"]\/api\/admin\/reports['"]\)/);
  assert.match(script, /requestJson\(['"]\/api\/admin\/sanctions['"]\)/);
  assert.match(script, /requestJson\(['"]\/api\/admin\/appeals['"]\)/);
  assert.doesNotMatch(script, /\/api\/dashboard/);
  assert.doesNotMatch(script, /const reports = \[/);
  assert.doesNotMatch(script, /const appeals = \[/);
});

test('dashboard stores all report history instead of only pending dashboard queue', () => {
  assert.match(script, /allReports/);
  assert.match(script, /reports = Array\.isArray\(allReports\) \? allReports : \[\];/);
  assert.doesNotMatch(script, /reports = Array\.isArray\(data\.hitl_reports\) \? data\.hitl_reports : \[\];/);
});

test('dashboard renders actual API report content in the alert and sheet', () => {
  assert.match(script, /function reportContent\(report\)/);
  assert.match(script, /report\.content_text/);
  assert.match(script, /sheetContent'\)\.textContent = reportContent\(report\);/);
  assert.match(script, /alertContent'\)\.textContent = reportContent\(report\);/);
});

test('dashboard lets admins play voice report files in the review sheet', () => {
  assert.match(script, /function audioUrlForReport\(report\)/);
  assert.match(script, /function fallbackAudioUrlForReport\(report\)/);
  assert.match(script, /String\(report\.content_type \|\| ''\)\.toLowerCase\(\) !== ['"]voice['"]/);
  assert.match(script, /\/api\/admin\/reports\/\$\{report\.id\}\/audio/);
  assert.match(script, /\/report-audio\?user=\$\{encodeURIComponent\(report\.reported_id \|\| ''\)\}/);
  assert.match(script, /sheetAudio'\)\.onerror = \(\) =>/);
  assert.match(script, /sheetAudioStatus'\)\.textContent = ['"]음성 파일을 찾을 수 없습니다/);
  assert.match(script, /sheetAudio'\)\.src = audioUrl;/);
  assert.match(script, /sheetAudioLink'\)\.href = audioUrl;/);
  assert.match(script, /sheetAudioRow'\)\.style\.display = audioUrl \? ['"]block['"] : ['"]none['"]/);
});

test('dashboard posts moderation decisions to backend admin APIs', () => {
  assert.match(script, /\/api\/admin\/reports\/\$\{report\.id\}\/sanction/);
  assert.match(script, /\/api\/admin\/reports\/\$\{report\.id\}\/dismiss/);
  assert.match(script, /sanction_type/);
  assert.match(script, /reviewer_id/);
});

test('dashboard exposes openReviewSheet for inline table buttons', () => {
  assert.match(script, /window\.openReviewSheet = openReviewSheet;/);
  assert.match(script, /onclick="openReviewSheet\(\$\{report\.id\}\)"/);
});

test('dashboard subscribes to admin SSE stream and refreshes on events', () => {
  assert.match(script, /new EventSource\(apiUrl\(['"]\/api\/admin\/stream['"]\)\)/);
  assert.match(script, /adminStream\.onmessage/);
  assert.match(script, /refreshDashboard\(\)/);
  assert.match(script, /bindAdminStream\(\);/);
});

test('dashboard falls back to polling so new reports still show alerts without SSE events', () => {
  assert.match(script, /let seenReportIds = new Set\(\);/);
  assert.match(script, /function rememberSeenReports\(nextReports = reports\)/);
  assert.match(script, /function findNewReports\(nextReports\)/);
  assert.match(script, /function bindReportPolling\(\)/);
  assert.match(script, /setInterval\(async \(\) =>/);
  assert.match(script, /showReportAlert\(\{ data: latestNewReport \}, \{ forceStage: true \}\)/);
  assert.match(script, /bindReportPolling\(\);/);
});

test('dashboard shows the exact incoming report when a new_report SSE arrives', () => {
  assert.match(script, /function showReportAlert\(message, options = \{\}\)/);
  assert.match(script, /message\.type === ['"]new_report['"]/);
  assert.match(script, /showReportAlert\(message, \{ forceStage: true \}\)/);
  assert.match(script, /forceStage/);
  assert.match(script, /await refreshDashboard\(\)/);
  assert.match(script, /alertMeta'\)\.textContent = `#\$\{reportId \|\| '-'\}/);
  assert.match(script, /alertContent'\)\.textContent = content;/);
  assert.match(script, /openReviewSheetFromAlert\(reportId, panel\)/);
});

test('dashboard merges new report and HITL alerts into one panel', () => {
  for (const id of ['alertPanel', 'alertMeta', 'alertContentBox', 'alertContent', 'alertStageBox', 'alertStage', 'alertReasonBox', 'alertReason', 'alertReview', 'alertDismiss']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /신고 내용/);
  assert.match(html, /단계/);
  assert.match(html, /사유: 상세한 정책 내용/);
  assert.doesNotMatch(html, /id="alertStageBox" style="display:none;"/);
  assert.doesNotMatch(html, /id="alertReasonBox" style="display:none;"/);
  assert.doesNotMatch(html, /id="alertPolicy"/);
  assert.doesNotMatch(html, /id="hitlAlertPanel"/);
  assert.match(script, /function parseStreamEvent\(event\)/);
  assert.match(script, /JSON\.parse\(event\.data\)/);
  assert.match(script, /function handleAdminStreamMessage\(event\)/);
  assert.match(script, /message\.type === ['"]new_hitl['"]/);
  assert.match(script, /showReportAlert\(message, \{ hitl: true \}\)/);
  assert.match(script, /const data = message\.data \|\| message;/);
  assert.match(script, /alertTitle'\)\.textContent = ['"]새 신고 접수['"];/);
  assert.match(script, /alertStageBox'\)\.style\.display = ['"]grid['"]/);
  assert.match(script, /alertStage'\)\.textContent = stage;/);
  assert.match(script, /function policyForStage\(rawLevel\)/);
  assert.match(script, /displayStageNumber\(data\)/);
  assert.match(script, /1단계/);
  assert.match(script, /5단계/);
  assert.match(script, /욕설강도/);
  assert.match(script, /음란성발언/);
  assert.match(script, /패드립/);
  assert.match(script, /폭력성발언/);
  assert.match(script, /alertReasonBox'\)\.style\.display = ['"]block['"]/);
  assert.match(script, /alertReason'\)\.textContent = policy;/);
  assert.doesNotMatch(script, /AI 판정 사유/);
  assert.match(script, /openReviewSheetFromAlert\(reportId, panel\)/);
});

test('backend dashboard queue includes HITL reports created by SSE workflow', () => {
  assert.match(adminRouter, /QUEUE_STATUSES = \("PENDING", "MANUAL_REVIEW_REQUIRED", "PENDING_HITL"\)/);
});

test('backend emits an SSE event as soon as any report is created', () => {
  assert.match(gameRouter, /from routers\.admin import notify_admins/);
  assert.match(gameRouter, /await notify_admins\(['"]new_report['"]/);
  assert.match(gameRouter, /"report_id": report_id/);
  assert.match(gameRouter, /"reporter": req\.reporter_id/);
  assert.match(gameRouter, /"target": req\.target_user_id/);
});

test('backend emits report_updated SSE events after manual review decisions', () => {
  assert.match(adminRouter, /await notify_admins\(['"]report_updated['"]/);
  assert.match(adminRouter, /"status": "COMPLETED"/);
  assert.match(adminRouter, /"status": "DISMISSED"/);
});

test('backend serves recorded voice files for admin playback', () => {
  assert.match(backendMain, /RECORDINGS_DIR/);
  assert.match(backendMain, /app\.mount\(['"]\/recordings['"]/);
  assert.match(backendMain, /StaticFiles\(directory=str\(RECORDINGS_DIR\)\)/);
  assert.match(adminRouter, /@router\.get\(['"]\/api\/admin\/reports\/\{report_id\}\/audio['"]\)/);
  assert.match(adminRouter, /FileResponse/);
  assert.match(adminRouter, /latest_recording_by_user/);
});
