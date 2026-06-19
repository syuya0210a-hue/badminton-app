/**
 * 福岡市公共施設案内・予約システムの空き状況を定期チェックし、
 * 空きが出たら LINE に通知するスクリプト
 *
 * 実行: cd scripts && npm run check
 * 10分間隔: npm run schedule
 */

import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import cron from "node-cron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPaths = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(__dirname, ".env"),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

const BASE_URL = "https://www3.11489.jp/fukuoka/user/Home";
const STATE_FILE = path.resolve(__dirname, "availability-state.json");
const DEBUG_CALENDAR = process.env.DEBUG_CALENDAR === "1" || process.env.DEBUG_CALENDAR === "true";

interface CheckConfig {
  reservationUserId: string;
  reservationPassword: string;
  lineChannelAccessToken?: string;
  lineChannelId?: string;
  lineChannelSecret?: string;
  lineUserId: string;
  /** チェック対象の開始日 YYYY-MM-DD（未指定時は翌週土曜） */
  checkDate?: string;
  /** チェック対象の終了日 YYYY-MM-DD（指定時は checkDate〜この日まで各日をチェック） */
  checkDateEnd?: string;
  /** 通知・検索で使う施設名（複数可）。FACILITY_NAMES をカンマ区切りで指定した場合は配列になる */
  facilityNames: string[];
  /** 検索結果の絞り込み用施設名の一部（未指定時は各 facilityNames をそのまま使用） */
  facilityNamePart?: string;
  /** 時間帯の表示名（例: 夜間枠）。通知メッセージ用 */
  timeSlotLabel: string;
  /** サイトの「その他の条件」で選ぶ時間帯の文言（例: 夜間）。未指定時は timeSlotLabel から「枠」を除いたもの */
  timeSlotFilter: string;
  purposeLabel: string;
}

function getConfig(): CheckConfig {
  const reservationUserId = process.env.RESERVATION_USER_ID;
  const reservationPassword = process.env.RESERVATION_PASSWORD;
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const lineChannelId = process.env.LINE_CHANNEL_ID;
  const lineChannelSecret = process.env.LINE_CHANNEL_SECRET;
  const lineUserId = process.env.LINE_USER_ID;

  if (!reservationUserId || !reservationPassword) {
    throw new Error(".env に RESERVATION_USER_ID と RESERVATION_PASSWORD を設定してください。");
  }
  if (!lineUserId) {
    throw new Error(".env に LINE_USER_ID を設定してください。");
  }

  const hasToken = !!lineToken;
  const hasChannelCreds = !!(lineChannelId && lineChannelSecret);
  if (!hasToken && !hasChannelCreds) {
    throw new Error(
      ".env に LINE の認証情報を設定してください。\n" +
        "  • LINE Official Account Manager の場合: LINE_CHANNEL_ID と LINE_CHANNEL_SECRET\n" +
        "  • または: LINE_CHANNEL_ACCESS_TOKEN（Channel access token を直接指定）"
    );
  }

  const facilityNamesRaw = process.env.FACILITY_NAMES || process.env.FACILITY_NAME || process.env.FACILITY_NAME_PART;
  const facilityNames = facilityNamesRaw
    ? facilityNamesRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : ["施設"];

  return {
    reservationUserId,
    reservationPassword,
    lineChannelAccessToken: lineToken,
    lineChannelId,
    lineChannelSecret,
    lineUserId,
    checkDate: process.env.CHECK_DATE,
    checkDateEnd: process.env.CHECK_DATE_END || undefined,
    facilityNames,
    facilityNamePart: process.env.FACILITY_NAME_PART || undefined,
    timeSlotLabel: process.env.TIME_SLOT_LABEL || "夜間枠",
    timeSlotFilter: process.env.TIME_SLOT_FILTER || (process.env.TIME_SLOT_LABEL || "夜間枠").replace(/枠$/, ""),
    purposeLabel: process.env.PURPOSE_LABEL || "バドミントン",
  };
}

interface AvailabilityState {
  lastUpdated: string;
  results: Record<string, "available" | "unavailable" | "unknown">;
}

function loadState(): AvailabilityState {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw) as AvailabilityState;
  } catch {
    return { lastUpdated: "", results: {} };
  }
}

function saveState(state: AvailabilityState): void {
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/** Channel ID + Secret からアクセストークンを取得（LINE Official Account Manager 用） */
async function getLineAccessTokenFromChannel(config: CheckConfig): Promise<string> {
  if (!config.lineChannelId || !config.lineChannelSecret) {
    throw new Error("LINE_CHANNEL_ID と LINE_CHANNEL_SECRET が必要です。");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.lineChannelId,
    client_secret: config.lineChannelSecret,
  });
  const res = await fetch("https://api.line.me/v2/oauth/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE アクセストークン取得失敗: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("LINE のレスポンスに access_token が含まれていません。");
  }
  return data.access_token;
}

/** 通知送信に使うアクセストークンを取得（設定に応じて直接指定 or Channel ID/Secret から取得） */
async function getLineAccessToken(config: CheckConfig): Promise<string> {
  if (config.lineChannelAccessToken) {
    return config.lineChannelAccessToken;
  }
  return getLineAccessTokenFromChannel(config);
}

async function sendLineNotification(config: CheckConfig, message: string): Promise<void> {
  const accessToken = await getLineAccessToken(config);
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: config.lineUserId,
      messages: [{ type: "text", text: message }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LINE 送信失敗: ${res.status} ${text}`);
  }
}

function log(msg: string, level: "info" | "warn" | "error" = "info"): void {
  const prefix = new Date().toISOString();
  const line = `[${prefix}] [${level.toUpperCase()}] ${msg}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const months = "一二三四五六七八九十".split("");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const week = "日月火水木金土"[d.getDay()];
  const monthStr = m <= 10 ? months[m - 1] : (m === 11 ? "十一" : "十二");
  return `${monthStr}月${day}日(${week})`;
}

/** チェック対象の日付の配列を返す（期間指定または実行日〜3ヶ月後） */
function getTargetDates(config: CheckConfig): string[] {
  const start = config.checkDate;
  const end = config.checkDateEnd;

  if (start && end) {
    const dates: string[] = [];
    const d = new Date(start + "T12:00:00");
    const endDate = new Date(end + "T12:00:00");
    if (d.getTime() > endDate.getTime()) return [];
    while (d.getTime() <= endDate.getTime()) {
      dates.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    return dates;
  }

  if (start) return [start];

  // 未指定時: 実行日から3ヶ月後まで毎日をチェック対象にする
  const dates: string[] = [];
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  const endDate = new Date(d);
  endDate.setMonth(endDate.getMonth() + 3);
  while (d.getTime() <= endDate.getTime()) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** 「次の期間へ」を押す回数（＝表示する月数 - 1）。2回で計3ヶ月分を見る */
const NEXT_PERIOD_CLICKS = 2;

async function ensureLogin(page: Page, config: CheckConfig): Promise<void> {
  const loginLink = page.getByRole("link", { name: /ログイン/i }).first();
  const visible = await loginLink.isVisible().catch(() => false);
  if (!visible) return;

  await loginLink.click();
  await page.waitForLoadState("networkidle").catch(() => {});

  const userIdInput = page.getByLabel(/利用者ID|ユーザーID|ID/i).or(
    page.locator('input[name*="id"], input[name*="userId"], input[type="text"]').first()
  );
  const passwordInput = page.getByLabel(/パスワード|password/i).or(
    page.locator('input[name*="password"], input[type="password"]').first()
  );

  if (!(await userIdInput.isVisible().catch(() => false)) || !(await passwordInput.isVisible().catch(() => false))) {
    log("ログインフォームが見つかりません。サイト構造の変更の可能性があります。", "warn");
    return;
  }

  await userIdInput.fill(config.reservationUserId);
  await passwordInput.fill(config.reservationPassword);

  const submitBtn = page.getByRole("button", { name: /ログイン|送信|実行/i }).first();
  await submitBtn.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
}

/** 施設選択画面で指定施設を探して選択し、次へ進む。見つからない施設は「対象施設が見つかりませんでした」とログ */
async function selectFacilitiesAndGoNext(page: Page, config: CheckConfig): Promise<{ ok: boolean }> {
  const maxLoadMore = 30;
  const wanted = new Set(config.facilityNames);
  const selected = new Set<string>();

  for (let i = 0; i < maxLoadMore; i++) {
    const bodyText = await page.locator("body").innerText().catch(() => "");

    for (const name of wanted) {
      if (selected.has(name)) continue;
      const el = page.getByText(name, { exact: false }).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => {});
        selected.add(name);
      }
    }

    if (selected.size === wanted.size) break;

    const loadMoreBtn = page.getByRole("button", { name: /さらに読み込む|もっと見る/i }).or(
      page.getByText(/さらに読み込む|もっと見る/i).first()
    );
    if (!(await loadMoreBtn.isVisible().catch(() => false))) break;
    await loadMoreBtn.click();
    await page.waitForTimeout(1500);
  }

  for (const name of wanted) {
    if (!selected.has(name)) {
      log(`対象施設が見つかりませんでした: ${name}`, "warn");
    }
  }

  const nextBtn = page.getByRole("button", { name: /次へ進む|次へ/i }).first();
  if (await nextBtn.isVisible().catch(() => false)) {
    await nextBtn.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    await dismissModalIfPresent(page);
    return { ok: true };
  }
  log("「次へ進む」ボタンが見つかりません。", "warn");
  return { ok: false };
}

/** 画面上のモーダル（ダイアログ）を閉じる。表示期間などのクリックがブロックされるのを防ぐ */
async function dismissModalIfPresent(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog").first();
  const visible = await dialog.isVisible().catch(() => false);
  if (!visible) return;

  const closeBtn = dialog.getByRole("button", { name: /閉じる|OK|×|取消|キャンセル|確認/ }).first();
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(500);
  } else {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await dialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
}

/** 表示期間1ヶ月・その他条件でカレンダー表示・指定時間帯を選んで表示 */
async function setCalendarDisplayAndShow(page: Page, config: CheckConfig): Promise<void> {
  await dismissModalIfPresent(page);

  const periodBtn = page.getByText(/^1[かヶ]月$/).first();
  if (await periodBtn.isVisible().catch(() => false)) await periodBtn.click();
  await page.waitForTimeout(500);

  const otherCond = page.getByRole("button", { name: /その他の条件で絞り込む|その他.*条件/i }).or(
    page.getByText(/その他の条件で絞り込む/i).first()
  );
  if (await otherCond.isVisible().catch(() => false)) await otherCond.click();
  await page.waitForTimeout(800);

  const calendarOpt = page.getByText(/カレンダー表示/i).first();
  if (await calendarOpt.isVisible().catch(() => false)) await calendarOpt.click();
  await page.waitForTimeout(300);

  const timeOpt = page.getByText(config.timeSlotFilter, { exact: false }).first();
  if (await timeOpt.isVisible().catch(() => false)) await timeOpt.click();
  await page.waitForTimeout(300);

  const showBtn = page.getByRole("button", { name: /表示/i }).first();
  if (await showBtn.isVisible().catch(() => false)) await showBtn.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);
  await page.waitForSelector('input[name*="UseDate"]', { state: "visible", timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(1500);
}

type CalendarItem = { facilityName: string; dateStr: string; status: "○" | "△" | "×" };

async function parseCalendarByUseDateInputs(page: Page, config: CheckConfig): Promise<CalendarItem[]> {
  const results: CalendarItem[] = [];
  const inputs = await page.locator("input[name*='UseDate']").all();
  if (inputs.length === 0) {
    console.warn("[parseCalendarByUseDateInputs] input[name*='UseDate'] が 0 件です");
    return results;
  }
  console.log(`[parseCalendarByUseDateInputs] UseDate inputs: ${inputs.length}`);
  for (const input of inputs) {
    const value = await input.getAttribute("value").catch(() => null);
    if (!value || value.length < 10) continue;
    const dateStr = value.slice(0, 10);
    const nameAttr = (await input.getAttribute("name").catch(() => "")) || "";
    const calendarIndexMatch = nameAttr.match(/Calendar\[(\d+)\]/);
    const facilityIndex = calendarIndexMatch ? parseInt(calendarIndexMatch[1], 10) : -1;
    const facilityName = facilityIndex >= 0 && facilityIndex < config.facilityNames.length
      ? config.facilityNames[facilityIndex]
      : null;

    const item = await input.evaluate((el) => {
      const cell = el.closest("td") || el.parentElement;
      if (!cell) return null;
      const label = cell.querySelector("label.btn-toggle, label.btn");
      const classList = (label?.className || "") + " " + (cell.className || "");
      const svgUse = cell.querySelector("use");
      const href = (svgUse?.getAttribute("xlink:href") || svgUse?.getAttribute("href") || "").toLowerCase();
      let status: "○" | "△" | "×" = "×";
      if (classList.includes("some") || href.includes("triangle")) status = "△";
      else if (classList.includes("open") || href.includes("circle") || href.includes("maru")) status = "○";
      return { status };
    }).catch(() => null);
    if (item && facilityName) results.push({ facilityName, dateStr, status: item.status });
  }
  return results;
}

/** 週表示カレンダー（日 月 火…土）をパース。施設ごとにテーブルがある想定 */
async function parseCalendarWeekView(
  page: Page,
  config: CheckConfig,
  periodIndex: number
): Promise<CalendarItem[]> {
  const results: CalendarItem[] = [];
  const baseDate = new Date();
  baseDate.setMonth(baseDate.getMonth() + periodIndex);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  const tables = await page.locator("table").all();
  for (const table of tables) {
    const tableText = await table.innerText().catch(() => "");
    const rows = await table.locator("tr").all();
    if (rows.length < 2) continue;
    const headerTxt = await Promise.all(
      (await rows[0].locator("th, td").all()).map((c) => c.innerText().then((t) => t.trim()))
    );
    if (!headerTxt.some((t) => /^[日月火水木金土]$/.test(t))) continue;

    const scopeText = await table.evaluate((el) => {
      const p = el.parentElement;
      return p ? p.innerText || "" : "";
    }).catch(() => "");
    const name = config.facilityNames.find((n) => (scopeText || tableText).includes(n));
    if (!name) continue;

    for (let r = 1; r < rows.length; r++) {
      const cells = await rows[r].locator("th, td").all();
      for (let c = 0; c < Math.min(cells.length, 7); c++) {
        const dayOfMonth = (r - 1) * 7 + c + 1 - firstDay;
        if (dayOfMonth < 1 || dayOfMonth > daysInMonth) continue;
        const cell = cells[c];
        const cellData = await cell?.evaluate((el) => {
          const useDateInput = el.querySelector<HTMLInputElement>('input[name*="UseDate"]');
          const dateStr = useDateInput?.value?.slice(0, 10) || null;
          const label = el.querySelector("label.btn-toggle, label.btn");
          const classList = (label?.className || "") + " " + (el.className || "");
          const svgUse = el.querySelector("use");
          const href = (svgUse?.getAttribute("xlink:href") || svgUse?.getAttribute("href") || "").toLowerCase();
          let status: "○" | "△" | "×" = "×";
          if (classList.includes("some") || href.includes("triangle")) status = "△";
          else if (classList.includes("open") || href.includes("circle") || href.includes("maru")) status = "○";
          else if (classList.includes("closed") || href.includes("cross") || href.includes("batsu")) status = "×";
          return { dateStr, status };
        }).catch(() => ({ dateStr: null as string | null, status: "×" as const }));

        const dateStr = cellData?.dateStr != null ? cellData.dateStr : `${year}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
        let status: "○" | "△" | "×" = cellData?.status ?? "×";
        const title = (await cell?.getAttribute("title").catch(() => "") || "").trim();
        const ariaLabel = (await cell?.getAttribute("aria-label").catch(() => "") || "").trim();
        const childLabels = await cell?.evaluate((el) => {
          return [...el.querySelectorAll("[title], [aria-label], [alt]")]
            .map((e) => (e.getAttribute("title") || e.getAttribute("aria-label") || e.getAttribute("alt") || "").trim())
            .filter(Boolean)
            .join(" ");
        }).catch(() => "") || "";
        const textContent = await cell?.evaluate((el) => (el as HTMLElement).textContent || "").catch(() => "") || "";
        const text = (await cell?.innerText().catch(() => "") || "").trim();
        const fullText = [text, title, ariaLabel, childLabels, textContent].filter(Boolean).join(" ");
        if (status === "×") {
          if (/○/.test(fullText) || (fullText.includes("空き") && !fullText.includes("空きなし") && !fullText.includes("一部空き"))) status = "○";
          else if (/△/.test(fullText) || fullText.includes("一部空き")) status = "△";
          else if (/空きなし/.test(fullText)) status = "×";
        }
        results.push({
          facilityName: name,
          dateStr,
          status,
        });
      }
    }
  }
  return results;
}

/** テーブル形式のカレンダーをパース（1行目が日付 1..31、以降の行が施設名＋○/△/×） */
async function parseCalendarAvailabilityTable(
  page: Page,
  config: CheckConfig,
  periodIndex: number
): Promise<CalendarItem[]> {
  const results: CalendarItem[] = [];
  const baseDate = new Date();
  baseDate.setMonth(baseDate.getMonth() + periodIndex);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;

  const table = page.locator("table").first();
  if (!(await table.isVisible().catch(() => false))) return results;

  const tableText = await table.innerText().catch(() => "");
  if (!/[○△×]/.test(tableText)) return results;

  const rows = await table.locator("tr").all();
  if (rows.length < 2) return results;

  const headerCells = await rows[0].locator("th, td").all();
  const headerTexts = await Promise.all(headerCells.map((c) => c.innerText().then((t) => t.trim())));
  let dayColumnStart = -1;
  for (let col = 0; col < headerTexts.length; col++) {
    const t = headerTexts[col] || "";
    if (t === "1" || t === "日" || /^\d{1,2}$/.test(t)) {
      dayColumnStart = col;
      break;
    }
  }
  if (dayColumnStart < 0) return results;

  const dayIndices: number[] = [];
  for (let col = dayColumnStart; col < headerTexts.length; col++) {
    const t = headerTexts[col] || "";
    const d = parseInt(t, 10);
    if (d >= 1 && d <= 31) dayIndices.push(d);
    else if (dayIndices.length > 0) break;
  }
  if (dayIndices.length === 0) return results;

  for (let r = 1; r < rows.length; r++) {
    const cells = await rows[r].locator("th, td").all();
    const firstCellText = (await cells[0]?.innerText().catch(() => "") || "").trim();
    const facilityName = config.facilityNames.find((name) =>
      firstCellText.includes(name) || firstCellText.startsWith(name)
    );
    if (!facilityName) continue;

    for (let col = 0; col < dayIndices.length && dayColumnStart + col < cells.length; col++) {
      const day = dayIndices[col];
      const cell = cells[dayColumnStart + col];
      const text = (await cell?.innerText().catch(() => "") || "").trim();
      let status: "○" | "△" | "×" = "×";
      if (/○/.test(text)) status = "○";
      else if (/△/.test(text)) status = "△";
      else if (/空きなし/.test(text)) status = "×";
      else if (/一部空き/.test(text)) status = "△";
      else if (/空き/.test(text)) status = "○";
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      results.push({ facilityName, dateStr, status });
    }
  }
  return results;
}

/** 施設別空き状況ページで1期間分の○/△/×を取得（テーブル優先、失敗時はテキスト） */
async function parseCalendarAvailability(
  page: Page,
  config: CheckConfig,
  periodIndex: number
): Promise<CalendarItem[]> {
  const useDateResults = await parseCalendarByUseDateInputs(page, config);
  if (useDateResults.length > 0) {
    log(`期間${periodIndex + 1}: UseDate から ${useDateResults.length} 件取得`, "info");
    return useDateResults;
  }
  const weekResults = await parseCalendarWeekView(page, config, periodIndex);
  if (weekResults.length > 0) {
    log(`期間${periodIndex + 1}: 週表示カレンダーから ${weekResults.length} 件取得`, "info");
    return weekResults;
  }
  const tableResults = await parseCalendarAvailabilityTable(page, config, periodIndex);
  if (tableResults.length > 0) {
    log(`期間${periodIndex + 1}: テーブルから ${tableResults.length} 件取得`, "info");
    return tableResults;
  }
  return parseCalendarAvailabilitySimple(page, config, periodIndex);
}

/** 施設別空き状況ページで1期間分の○/△/×を取得（body テキストから施設名＋○/△/× を検出） */
async function parseCalendarAvailabilitySimple(
  page: Page,
  config: CheckConfig,
  periodIndex: number
): Promise<CalendarItem[]> {
  const results: CalendarItem[] = [];
  const bodyText = await page.locator("body").innerText().catch(() => "");

  if (DEBUG_CALENDAR) {
    const debugPath = path.resolve(__dirname, `debug-calendar-period-${periodIndex + 1}.txt`);
    fs.writeFileSync(debugPath, bodyText, "utf-8");
    log(`デバッグ: 期間${periodIndex + 1}のページ内容を ${path.basename(debugPath)} に保存しました。`, "info");
  }

  const baseDate = new Date();
  baseDate.setMonth(baseDate.getMonth() + periodIndex);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth() + 1;

  for (let i = 0; i < config.facilityNames.length; i++) {
    const facilityName = config.facilityNames[i];
    if (!bodyText.includes(facilityName)) continue;

    const start = bodyText.indexOf(facilityName);
    const nextStart = config.facilityNames.slice(i + 1).reduce<number | null>((acc, name) => {
      const idx = bodyText.indexOf(name, start + 1);
      if (idx === -1) return acc;
      return acc === null ? idx : Math.min(acc, idx);
    }, null);
    const end = nextStart !== null ? nextStart : bodyText.length;
    const block = bodyText.slice(start, Math.min(end, start + 3000));

    const hasMaru = /○/.test(block);
    const hasSankaku = /△/.test(block);
    const status: "○" | "△" | "×" = hasMaru ? "○" : hasSankaku ? "△" : "×";

    const dayMatches = block.match(/\d{1,2}(?=\s*[○△×])|(\d{1,2})\s*[○△×]/g);
    if (dayMatches && dayMatches.length > 0) {
      const seen = new Set<string>();
      for (const m of dayMatches) {
        const day = parseInt(m.replace(/\D/g, ""), 10) || 1;
        if (day < 1 || day > 31) continue;
        const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (seen.has(dateStr)) continue;
        seen.add(dateStr);
        results.push({ facilityName, dateStr, status });
      }
    } else {
      const markRow = block.match(/([○△×]\s*)+/g);
      if (markRow && markRow.length > 0) {
        const flat = markRow.join(" ").replace(/\s+/g, " ").trim().split(/\s+/);
        const marks = flat.filter((s) => /^[○△×]$/.test(s));
        if (marks.length >= 28 && marks.length <= 31) {
          for (let day = 1; day <= marks.length; day++) {
            const ch = marks[day - 1];
            const st: "○" | "△" | "×" = ch === "○" ? "○" : ch === "△" ? "△" : "×";
            results.push({
              facilityName,
              dateStr: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
              status: st,
            });
          }
        }
      }
    }
  }
  return results;
}

/** メインの空き照会フロー: 利用目的→施設選択→期間表示→○/△/×パース→次の期間へ×2 */
async function runAvailabilityFlow(page: Page, config: CheckConfig): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(1000);

  await ensureLogin(page, config);

  const inquiryLink = page.getByRole("link", { name: /空き照会|申込/i }).first();
  if (!(await inquiryLink.isVisible().catch(() => false))) {
    const anyLink = page.locator('a[href*="Vacancy"], a:has-text("空き")').first();
    await anyLink.click().catch(() => {
      throw new Error("空き照会へのリンクが見つかりません");
    });
  } else {
    await inquiryLink.click();
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);

  const byPurpose = page.getByText(/利用目的から探す/i).first();
  if (await byPurpose.isVisible().catch(() => false)) await byPurpose.click();
  await page.waitForTimeout(800);

  const indoor = page.getByText("屋内スポーツ").first();
  if (await indoor.isVisible().catch(() => false)) await indoor.click();
  await page.waitForTimeout(800);

  const purpose = page.getByText(config.purposeLabel, { exact: true }).first();
  if (await purpose.isVisible().catch(() => false)) {
    await purpose.click();
  } else {
    await page.getByText(config.purposeLabel).first().click().catch(() => {});
  }
  await page.waitForTimeout(800);

  const searchBtn = page.getByRole("button", { name: /検索/i }).first();
  if (await searchBtn.isVisible().catch(() => false)) await searchBtn.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(2000);

  const selectResult = await selectFacilitiesAndGoNext(page, config);
  if (!selectResult.ok) return;

  const state = loadState();
  const todayStr = new Date().toISOString().slice(0, 10);

  for (let periodIndex = 0; periodIndex <= NEXT_PERIOD_CLICKS; periodIndex++) {
    if (periodIndex === 0) {
      await setCalendarDisplayAndShow(page, config);
    } else {
      await page.waitForTimeout(1000);
    }

    const items = await parseCalendarAvailability(page, config, periodIndex);

    if (items.length === 0) {
      log(
        `期間${periodIndex + 1}: カレンダーから日付ごとの○/△/×を取得できませんでした。通知は行いません。`,
        "warn"
      );
    } else {
      for (const { facilityName, dateStr, status } of items) {
        if (dateStr < todayStr) continue;
        const stateKey = `${facilityName}_${dateStr}_${config.timeSlotLabel}`;
        const facilityAvailable = status === "○" || status === "△";
        const previous = state.results[stateKey];
        state.results[stateKey] = facilityAvailable ? "available" : "unavailable";
        if (previous !== "available" && facilityAvailable) {
          const dateLabel = formatDateLabel(dateStr);
          const message = `【空き通知】${facilityName}の${dateLabel}の${config.timeSlotLabel}に空きが出ました。\n予約はこちら：${BASE_URL}`;
          await sendLineNotification(config, message);
          log(`LINE に通知を送信しました: ${facilityName} ${dateStr}`);
        } else if (previous === undefined) {
          log(`初回チェック: ${facilityName} ${dateStr} -> ${facilityAvailable ? "空きあり" : "空きなし"}`);
        }
      }
    }

    saveState(state);

    if (periodIndex < NEXT_PERIOD_CLICKS) {
      await dismissModalIfPresent(page);
      const nextPeriodBtn = page.getByText(/次の期間へ?/).first();
      if (await nextPeriodBtn.isVisible().catch(() => false)) {
        await nextPeriodBtn.click();
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(2000);
        await page.waitForSelector('input[name*="UseDate"]', { state: "visible", timeout: 15000 }).catch(() => null);
        await page.waitForTimeout(1000);
      }
    }
  }
}

async function runOneCheck(browser: Browser, config: CheckConfig): Promise<void> {
  if (config.facilityNames.length === 0 || config.facilityNames[0] === "施設") {
    log("FACILITY_NAME または FACILITY_NAMES を .env に設定してください。", "warn");
    return;
  }

  log(`チェック開始: 施設 ${config.facilityNames.join(", ")}、時間帯 ${config.timeSlotLabel}、表示は3ヶ月分`);

  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await runAvailabilityFlow(page, config);
  } catch (e) {
    log(`実行エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
  } finally {
    await page.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const scheduleMode = process.argv.includes("--schedule");
  let config: CheckConfig;

  try {
    config = getConfig();
  } catch (e) {
    log(e instanceof Error ? e.message : String(e), "error");
    process.exit(1);
  }

  const run = async () => {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      await runOneCheck(browser, config);
    } catch (e) {
      log(`実行エラー: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  };

  if (scheduleMode) {
    log("10分間隔でスケジュール実行を開始します。");
    cron.schedule("*/10 * * * *", run);
    await run();
    await new Promise(() => {});
  } else {
    await run();
  }
}

main();
