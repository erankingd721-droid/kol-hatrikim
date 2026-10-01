#!/usr/bin/env node
// הבוט היומי של "כל הטריקים".
// סורק את YouTube Shorts ואת TikTok, מסנן טריקים של מיינקראפט וכותב אותם ל-data/.
//
// הרצה:  node bot/bot.mjs          (כותב קבצים)
//        node bot/bot.mjs --dry    (רק מדפיס מה היה נכתב)
//
// משתני סביבה:
//   YOUTUBE_API_KEY                         מפתח ל-YouTube Data API v3
//   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET  (רשות) גישה ל-TikTok Research API
//   BOT_NOW                                 (רשות) תאריך הרצה מדומה, לבדיקות

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry');
const DAY = 86400000;
const UA = 'Mozilla/5.0 (compatible; kol-hatrikim-bot/1.0)';

const config = JSON.parse(await readFile(path.join(ROOT, 'bot', 'config.json'), 'utf8'));
const now = new Date(process.env.BOT_NOW || Date.now());
const from = new Date(now.getTime() - config.lookbackDays * DAY);
const to = now;
// כל הרצה (פעם ביום) נשמרת בקובץ משלה לפי התאריך: data/weeks/<תאריך>.json
const weekId = isoDate(now);

const isMinecraft = matcher(config.mustMatch.minecraft);
const isTrickWord = matcher(config.mustMatch.trick);
const isExcluded = matcher(config.exclude);
const categoryMatchers = config.categories.map((c) => ({ name: c.name, test: matcher(c.words) }));

function log(...args) {
  console.log('[bot]', ...args);
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// מילים לטיניות קצרות נבדקות כמילה שלמה ("xp" לא יתפוס את "expert"),
// מילים ארוכות ועברית נבדקות כחלק מהטקסט (כדי לתפוס האשטגים ותחיליות).
function matcher(words) {
  const tests = words.map((w) => {
    const lw = w.toLowerCase();
    if (/[a-z]/.test(lw) && lw.length <= 4) {
      // הגבול הוא רק מול אותיות לטיניות, כדי ש"בpvp" בעברית עדיין ייתפס
      const re = new RegExp(`(^|[^a-z0-9])${escapeRe(lw)}(?=$|[^a-z0-9])`);
      return (t) => re.test(t);
    }
    return (t) => t.includes(lw);
  });
  return (text) => {
    const t = String(text || '').toLowerCase();
    return tests.some((f) => f(t));
  };
}

function isTrick(text) {
  return isMinecraft(text) && isTrickWord(text) && !isExcluded(text);
}

function categorize(text) {
  const hit = categoryMatchers.find((c) => c.test(text));
  return hit ? hit.name : config.defaultCategory;
}

function clean(s, max = 140) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

// כותרת לתצוגה: בלי ערימת האשטגים (#shorts #minecraft...) ובלי סימנים מיותרים בסוף
function cleanTitle(s) {
  const noTags = String(s || '').replace(/#[^\s#]+/g, ' ').replace(/[\s|\-–—:·,]+$/u, '');
  return clean(noTags) || clean(s);
}

async function getJson(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    // נטפל למטה
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || '';
    throw new Error(`HTTP ${res.status}${msg ? ': ' + msg : ''}`);
  }
  if (data === null) throw new Error('התקבלה תשובה שאינה JSON');
  return data;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// ---------- YouTube Shorts ----------

function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function readLinks(file, allowed) {
  let raw = '';
  try {
    raw = await readFile(path.join(ROOT, file), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && allowed.test(l));
}

async function youtube(prior) {
  const key = process.env.YOUTUBE_API_KEY;
  const links = await youtubeLinks(prior);
  if (!key) {
    if (!links.scanned) {
      log('YouTube: אין YOUTUBE_API_KEY ואין קישורים ב-' + config.youtube.linksFile + ', מדלג');
      return { ok: false, mode: 'off', reason: 'no-key', scanned: 0, items: [] };
    }
    log(`YouTube: אין מפתח API, משתמש ב-${links.items.length} קישורים ידניים`);
    return { ok: true, mode: 'links', scanned: links.scanned, items: links.items };
  }
  const found = await youtubeSearch(key);
  return { ok: true, mode: 'api', scanned: found.scanned + links.scanned, items: [...links.items, ...found.items] };
}

// קישורים שהוספתם ידנית ל-youtube-links.txt. עובד גם בלי מפתח API (דרך oEmbed הרשמי).
async function youtubeLinks(prior) {
  const links = await readLinks(config.youtube.linksFile, /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//);
  const ids = new Set();
  const items = [];
  for (const link of links) {
    const id = (link.match(/(?:shorts\/|[?&]v=|youtu\.be\/|embed\/)([\w-]{11})/) || [])[1];
    if (!id || ids.has(id)) continue;
    ids.add(id);
    if (prior.has('yt:' + id)) continue;
    try {
      const o = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`);
      items.push({
        id: 'yt:' + id,
        platform: 'youtube',
        videoId: id,
        url: `https://www.youtube.com/shorts/${id}`,
        title: cleanTitle(o.title) || 'סרטון YouTube',
        author: clean(o.author_name, 60),
        authorUrl: /^https:\/\/www\.youtube\.com\//.test(o.author_url || '') ? o.author_url : null,
        thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        views: null,
        publishedAt: null,
        category: categorize(o.title),
        manual: true,
      });
    } catch (e) {
      log(`YouTube: oEmbed נכשל עבור ${link}: ${e.message}`);
    }
  }
  return { scanned: ids.size, items };
}

async function youtubeSearch(key) {
  const ids = new Set();
  for (const q of config.youtube.queries) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({
      part: 'snippet',
      q,
      type: 'video',
      videoDuration: 'short',
      order: 'viewCount',
      safeSearch: 'strict',
      publishedAfter: from.toISOString(),
      maxResults: String(config.youtube.resultsPerQuery),
      key,
    });
    const data = await getJson(url);
    for (const it of data.items || []) if (it.id?.videoId) ids.add(it.id.videoId);
  }
  log(`YouTube: ${ids.size} סרטונים מהחיפוש`);

  const items = [];
  const all = [...ids];
  for (let i = 0; i < all.length; i += 50) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({
      part: 'snippet,contentDetails,statistics',
      id: all.slice(i, i + 50).join(','),
      key,
    });
    const data = await getJson(url);
    for (const v of data.items || []) {
      const secs = parseDuration(v.contentDetails?.duration);
      if (!secs || secs > config.youtube.maxDurationSeconds) continue;
      const sn = v.snippet || {};
      const text = [sn.title, sn.description, (sn.tags || []).join(' ')].join(' ');
      if (!isTrick(text)) continue;
      const views = Number(v.statistics?.viewCount || 0);
      if (views < config.youtube.minViews) continue;
      const th = sn.thumbnails || {};
      items.push({
        id: 'yt:' + v.id,
        platform: 'youtube',
        videoId: v.id,
        url: `https://www.youtube.com/shorts/${v.id}`,
        title: cleanTitle(sn.title),
        author: clean(sn.channelTitle, 60),
        authorUrl: sn.channelId ? `https://www.youtube.com/channel/${sn.channelId}` : null,
        thumb: (th.high || th.medium || th.default || {}).url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
        views,
        publishedAt: sn.publishedAt || null,
        category: categorize(text),
      });
    }
  }
  log(`YouTube: ${items.length} טריקים עברו את הסינון`);
  return { scanned: ids.size, items };
}

// ---------- TikTok ----------

async function tiktokResearch() {
  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!token.access_token) throw new Error('לא התקבל טוקן: ' + (token.error_description || token.error || tokenRes.status));

  const ymd = (d) => isoDate(d).replaceAll('-', '');
  const data = await getJson(
    'https://open.tiktokapis.com/v2/research/video/query/?fields=id,video_description,create_time,username,view_count,hashtag_names',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { and: [{ operation: 'IN', field_name: 'hashtag_name', field_values: config.tiktok.researchHashtags }] },
        start_date: ymd(from),
        end_date: ymd(to),
        max_count: config.tiktok.researchMaxCount,
      }),
    }
  );
  return (data.data?.videos || [])
    .filter((v) => v.id && v.username)
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    .slice(0, config.maxPerPlatform * 2)
    .map((v) => ({
      id: String(v.id),
      url: `https://www.tiktok.com/@${v.username}/video/${v.id}`,
      text: [v.video_description, (v.hashtag_names || []).join(' ')].join(' '),
      views: Number.isFinite(v.view_count) ? v.view_count : null,
      publishedAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
      manual: false,
    }));
}

async function resolveTikTok(link) {
  let id = (link.match(/\/video\/(\d+)/) || [])[1];
  if (id) return { id, url: link.split('?')[0] };
  // קישורים מקוצרים (vm.tiktok.com/...) מפנים לכתובת המלאה
  const res = await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': UA } });
  id = (res.url.match(/\/video\/(\d+)/) || [])[1];
  return id ? { id, url: res.url.split('?')[0] } : null;
}

// ImageMagick (קיים בשרתים של GitHub). ב-Windows לא נוגעים ב-convert, כי שם זו פקודה אחרת לגמרי.
let imageTool;
async function findImageTool() {
  if (imageTool !== undefined) return imageTool;
  imageTool = null;
  const candidates = process.platform === 'win32' ? ['magick'] : ['magick', 'convert'];
  for (const cmd of candidates) {
    try {
      await execFileAsync(cmd, ['-version']);
      imageTool = cmd;
      break;
    } catch {
      // לא מותקן
    }
  }
  return imageTool;
}

// TikTok שולח לפעמים PNG של כמה מגה. מקטינים ל-JPG ברוחב 540 כשאפשר.
async function saveThumb(url, id) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': UA } });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8_000_000) return null;
    await mkdir(path.join(DATA, 'thumbs'), { recursive: true });

    const tool = await findImageTool();
    if (tool && buf.length > 150_000) {
      const rel = `data/thumbs/tiktok-${id}.jpg`;
      if (DRY) return rel;
      const tmp = path.join(DATA, 'thumbs', `tmp-${id}`);
      await writeFile(tmp, buf);
      try {
        await execFileAsync(tool, [tmp, '-resize', '540x>', '-strip', '-quality', '80', path.join(ROOT, rel)]);
        return rel;
      } finally {
        await rm(tmp, { force: true });
      }
    }

    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    const rel = `data/thumbs/tiktok-${id}.${ext}`;
    if (!DRY) await writeFile(path.join(ROOT, rel), buf);
    return rel;
  } catch {
    return null;
  }
}

async function tiktok(prior) {
  const candidates = new Map();
  let mode = 'off';

  if (process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET) {
    try {
      for (const v of await tiktokResearch()) candidates.set(v.id, v);
      mode = 'research';
      log(`TikTok: ${candidates.size} סרטונים מ-Research API`);
    } catch (e) {
      log('TikTok Research API נכשל:', e.message);
    }
  }

  const links = await readLinks(config.tiktok.linksFile, /^https:\/\/(www\.|m\.|vm\.|vt\.)?tiktok\.com\//);
  if (links.length && mode === 'off') mode = 'links';
  for (const link of links) {
    try {
      const r = await resolveTikTok(link);
      if (r && !candidates.has(r.id)) candidates.set(r.id, { ...r, text: '', views: null, publishedAt: null, manual: true });
    } catch (e) {
      log(`TikTok: לא הצלחתי לפתוח ${link}: ${e.message}`);
    }
  }

  const items = [];
  for (const v of candidates.values()) {
    if (prior.has('tt:' + v.id)) continue;
    try {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(v.url)}`;
      // TikTok לפעמים איטי: ניסיון שני לפני שמוותרים
      const o = await getJson(oembedUrl).catch(() => getJson(oembedUrl));
      const text = [o.title, v.text].join(' ');
      // קישורים שהוספתם ידנית עוברים תמיד; כל השאר צריכים להיראות כמו טריק
      if (!v.manual && !isTrick(text)) continue;
      items.push({
        id: 'tt:' + v.id,
        platform: 'tiktok',
        videoId: v.id,
        url: v.url,
        title: cleanTitle(o.title) || 'סרטון TikTok',
        author: clean(o.author_name, 60),
        authorUrl: /^https:\/\/www\.tiktok\.com\//.test(o.author_url || '') ? o.author_url : null,
        thumb: o.thumbnail_url ? await saveThumb(o.thumbnail_url, v.id) : null,
        views: v.views,
        publishedAt: v.publishedAt,
        category: categorize(text),
        manual: v.manual,
      });
    } catch (e) {
      log(`TikTok: oEmbed נכשל עבור ${v.url}: ${e.message}`);
    }
  }
  log(`TikTok: ${items.length} טריקים (מצב: ${mode})`);
  return { ok: mode !== 'off', mode, scanned: candidates.size, items };
}

// ---------- ריצה ----------

async function priorIds() {
  const ids = new Set();
  let files = [];
  try {
    files = await readdir(path.join(DATA, 'weeks'));
  } catch {
    return ids;
  }
  for (const f of files) {
    if (!f.endsWith('.json') || f === `${weekId}.json`) continue;
    const w = await readJson(path.join(DATA, 'weeks', f), {});
    for (const t of w.tricks || []) ids.add(t.id);
  }
  return ids;
}

async function safely(name, fn) {
  try {
    return await fn();
  } catch (e) {
    log(`${name} נכשל:`, e.message);
    return { ok: false, reason: 'error', error: e.message, scanned: 0, items: [] };
  }
}

const rank = (a, b) => (b.manual ? 1 : 0) - (a.manual ? 1 : 0) || (b.views ?? -1) - (a.views ?? -1);

async function main() {
  log(`סריקה ${weekId}: סרטונים מ-${isoDate(from)} עד ${isoDate(to)}`);
  const prior = await priorIds();
  const [yt, tt] = await Promise.all([safely('YouTube', () => youtube(prior)), safely('TikTok', () => tiktok(prior))]);

  if (!yt.ok && !tt.ok) {
    log('אף מקור לא עבד. צריך להגדיר YOUTUBE_API_KEY או להוסיף קישורים ל-bot/tiktok-links.txt. לא נכתב כלום.');
    process.exitCode = 1;
    return;
  }

  // אם הבוט רץ שוב באותו יום, שומרים את מה שכבר נמצא
  const existing = await readJson(path.join(DATA, 'weeks', `${weekId}.json`), { tricks: [] });
  const pool = new Map();
  for (const t of [...existing.tricks, ...yt.items, ...tt.items]) {
    if (!prior.has(t.id)) pool.set(t.id, { ...pool.get(t.id), ...t });
  }

  // קודם עד maxPerPlatform מכל פלטפורמה, ואם נשאר מקום (למשל אין TikTok היום) ממלאים ממה שנשאר
  const sorted = [...pool.values()].sort(rank);
  const per = { youtube: 0, tiktok: 0 };
  const chosen = new Set();
  for (const t of sorted) {
    if (chosen.size >= config.maxTricksPerRun) break;
    if (per[t.platform] >= config.maxPerPlatform) continue;
    per[t.platform]++;
    chosen.add(t);
  }
  for (const t of sorted) {
    if (chosen.size >= config.maxTricksPerRun) break;
    if (!chosen.has(t)) {
      per[t.platform]++;
      chosen.add(t);
    }
  }
  // באתר מערבבים: YouTube, TikTok, YouTube, TikTok...
  const lists = ['youtube', 'tiktok'].map((p) => sorted.filter((t) => chosen.has(t) && t.platform === p));
  const tricks = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) {
    for (const l of lists) if (l[i]) tricks.push(l[i]);
  }
  for (const t of tricks) delete t.manual;

  const week = {
    week: weekId,
    from: isoDate(from),
    to: isoDate(to),
    generatedAt: now.toISOString(),
    scanned: yt.scanned + tt.scanned,
    sources: {
      youtube: { ok: yt.ok, mode: yt.mode || 'off', reason: yt.reason || null, scanned: yt.scanned },
      tiktok: { ok: tt.ok, mode: tt.mode || 'off', scanned: tt.scanned },
    },
    tricks,
  };

  log(`נבחרו ${tricks.length} טריקים (YouTube ${per.youtube}, TikTok ${per.tiktok})`);
  if (DRY) {
    console.log(JSON.stringify(week, null, 2));
    return;
  }

  await mkdir(path.join(DATA, 'weeks'), { recursive: true });
  await writeFile(path.join(DATA, 'weeks', `${weekId}.json`), JSON.stringify(week, null, 2) + '\n');

  const weeks = (await readJson(path.join(DATA, 'weeks.json'), [])).filter((w) => w.week !== weekId);
  weeks.push({ week: weekId, from: week.from, to: week.to, count: tricks.length });
  weeks.sort((a, b) => b.week.localeCompare(a.week));
  await writeFile(path.join(DATA, 'weeks.json'), JSON.stringify(weeks, null, 2) + '\n');

  // העמוד הראשי: כל הטריקים מהימים האחרונים ביחד (החדשים קודם), כדי שתמיד יהיה הרבה
  const recent = [];
  const seen = new Set();
  const days = weeks.slice(0, config.recentDays);
  for (const w of days) {
    const d = w.week === weekId ? week : await readJson(path.join(DATA, 'weeks', `${w.week}.json`), { tricks: [] });
    for (const t of d.tricks || []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      recent.push({ ...t, day: w.week });
    }
  }
  const latest = { ...week, recentDays: days.length, newToday: tricks.length, tricks: recent.slice(0, config.maxOnHomePage) };
  await writeFile(path.join(DATA, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  log(`נכתב: data/weeks/${weekId}.json, data/weeks.json, data/latest.json (${latest.tricks.length} טריקים מ-${days.length} ימים)`);
}

await main();
