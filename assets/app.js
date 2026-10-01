// כל הטריקים: טוען את מה שהבוט מצא ומציג אותו.
(() => {
  'use strict';

  const CATS = ['רדסטון', 'חוות', 'בנייה', 'PvP', 'הישרדות', 'סודות', 'כללי'];
  const PLATFORMS = {
    youtube: { badge: 'SHORTS', name: 'YouTube' },
    tiktok: { badge: 'TIKTOK', name: 'TikTok' },
  };
  // צבעי "בלוק" לתמונה זמנית, עד שהתמונה האמיתית נטענת (או אם אין)
  const TEXTURES = {
    'רדסטון': ['#7f7f7f', '#747474', '#8a8a8a', '#6b6b6b', '#7f7f7f', '#a3271c'],
    'חוות': ['#5d9b2f', '#6aaa36', '#4f8a26', '#5d9b2f', '#c9b04a'],
    'הישרדות': ['#3f63d6', '#3557c4', '#4a70e0', '#2f4fb4'],
    'סודות': ['#1a1326', '#231a33', '#2e2142', '#130e1c', '#5b2f8f'],
    'בנייה': ['#a2824e', '#9a7a46', '#b08f57', '#8c6d3d', '#6b5230'],
    'PvP': ['#6f2b2b', '#7d3232', '#5e2323', '#8a3a3a'],
    'כללי': ['#866043', '#79553a', '#8f6a4a', '#5d9b2f', '#6e4c33'],
  };

  const $ = (sel) => document.querySelector(sel);
  const state = { platform: 'all', cat: 'all', tricks: [] };

  const params = new URLSearchParams(location.search);
  const demo = params.has('demo');
  const weekParam = params.get('week');
  const archiveWeek = weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam) ? weekParam : null;

  // ---------- כלים ----------

  function h(tag, props, children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children || [])) if (c) el.append(c);
    return el;
  }

  // רק קישורי https או קבצים מהאתר עצמו
  function safeUrl(u) {
    if (!u) return null;
    try {
      const url = new URL(u, location.href);
      if (url.protocol === 'https:' || url.origin === location.origin) return url.href;
    } catch (e) {
      // לא קישור תקין
    }
    return null;
  }

  function parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const dm = (d) => (d ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}` : '');

  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  }

  function hashSeed(s) {
    let x = 7;
    for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 233280;
    return x;
  }

  const compact = new Intl.NumberFormat('he-IL', { notation: 'compact', maximumFractionDigits: 1 });
  const whenFmt = new Intl.DateTimeFormat('he-IL', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
  });

  function paintPixels(canvas, seed, pal) {
    const ctx = canvas.getContext('2d');
    let s = seed;
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 6; x++) {
        s = (s * 9301 + 49297) % 233280;
        ctx.fillStyle = pal[Math.floor((s / 233280) * pal.length)];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // ---------- עיצוב ----------

  function setTheme(theme) {
    if (!window.KH_FONTS || !window.KH_FONTS[theme]) return;
    document.documentElement.setAttribute('data-theme', theme);
    $('#theme-fonts').href = window.KH_FONTS[theme];
    document.querySelectorAll('[data-theme-btn]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.themeBtn === theme));
    });
    try {
      localStorage.setItem('kh-theme', theme);
    } catch (e) {
      // בלי זיכרון: העיצוב יחזור לברירת המחדל בביקור הבא
    }
  }

  document.querySelectorAll('[data-theme-btn]').forEach((b) => {
    b.addEventListener('click', () => setTheme(b.dataset.themeBtn));
  });
  setTheme(document.documentElement.getAttribute('data-theme') || 'mc');

  // ---------- ספירה לאחור לסריקה הבאה (יום ראשון לפנות בוקר) ----------

  function nextScan(now) {
    const d = new Date(now);
    d.setHours(3, 0, 0, 0);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    if (d <= now) d.setDate(d.getDate() + 7);
    return d;
  }

  const cd = {};
  document.querySelectorAll('.cd-num').forEach((el) => { cd[el.dataset.unit] = el; });
  function tick() {
    const now = new Date();
    const left = Math.max(0, Math.floor((nextScan(now) - now) / 1000));
    cd.d.textContent = pad(Math.floor(left / 86400));
    cd.h.textContent = pad(Math.floor((left % 86400) / 3600));
    cd.m.textContent = pad(Math.floor((left % 3600) / 60));
    cd.s.textContent = pad(left % 60);
  }
  tick();
  setInterval(tick, 1000);

  // ---------- כרטיס טריק ----------

  function card(t) {
    const p = PLATFORMS[t.platform];
    const canvas = h('canvas', { width: 6, height: 11, 'aria-hidden': 'true' });
    paintPixels(canvas, hashSeed(t.id || t.title), TEXTURES[t.category] || TEXTURES['כללי']);

    // תמונה אמיתית מהסרטון. ב-Shorts מנסים קודם את התמונה האנכית, ואם אין, את הרגילה.
    const sources = [];
    if (t.platform === 'youtube' && /^[\w-]{11}$/.test(t.videoId || '')) {
      sources.push(`https://i.ytimg.com/vi/${t.videoId}/oar2.jpg`, `https://i.ytimg.com/vi/${t.videoId}/hq720.jpg`);
    }
    if (safeUrl(t.thumb)) sources.push(safeUrl(t.thumb));
    let img = null;
    if (sources.length) {
      img = h('img', { src: sources.shift(), alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => {
        if (sources.length) img.src = sources.shift();
        else img.remove();
      });
      // YouTube מחזיר תמונה אפורה קטנה (120×90) כשאין תמונה אנכית
      img.addEventListener('load', () => {
        if (img.naturalWidth <= 120 && sources.length) img.src = sources.shift();
      });
    }

    const views = Number.isFinite(t.views) ? h('span', { class: 'views', text: `${compact.format(t.views)} צפיות` }) : null;
    const play = h('span', { class: 'play', 'aria-hidden': 'true' });
    play.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="miter"><path d="M7 4 L19 12 L7 20 Z"/></svg>';

    const media = h('div', { class: 'media' });
    const thumbBtn = h('button', {
      type: 'button',
      class: 'thumb',
      'aria-label': `ניגון: ${t.title}`,
      onclick: () => playInCard(t, media, thumbBtn),
    }, [canvas, img, h('span', { class: 'badge', 'data-platform': t.platform, text: p.badge }), play, views]);
    media.append(thumbBtn);

    const authorUrl = safeUrl(t.authorUrl);
    const author = t.author
      ? authorUrl
        ? h('a', { class: 'author', href: authorUrl, target: '_blank', rel: 'noopener', dir: 'auto', text: t.author })
        : h('span', { class: 'author', dir: 'auto', text: t.author })
      : null;

    const url = safeUrl(t.url);
    return h('article', { class: 'card panel' }, [
      media,
      h('h3', { class: 'card-title', dir: 'auto', text: t.title }),
      h('div', { class: 'card-meta' }, [h('span', { class: 'tag', text: t.category || 'כללי' }), author]),
      url ? h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener', text: `לצפייה ב-${p.name}` }) : null,
    ]);
  }

  // ---------- ניגון בתוך הכרטיס ----------

  function embedUrl(t) {
    const id = t.videoId || '';
    if (t.platform === 'youtube' && /^[\w-]{11}$/.test(id)) {
      return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&loop=1&playlist=${id}`;
    }
    if (t.platform === 'tiktok' && /^\d{5,25}$/.test(id)) {
      return `https://www.tiktok.com/player/v1/${id}?autoplay=1&loop=1&music_info=1&description=0&rel=0`;
    }
    return null;
  }

  // רק סרטון אחד מתנגן בכל רגע: כשמתחילים חדש, הקודם חוזר לתמונה
  let playing = null;

  function playInCard(t, media, thumbBtn) {
    const embed = embedUrl(t);
    if (!embed) {
      const url = safeUrl(t.url);
      if (url) window.open(url, '_blank', 'noopener');
      return;
    }
    if (playing) playing();
    media.replaceChildren(h('iframe', {
      src: embed,
      title: t.title,
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write',
      allowfullscreen: true,
      referrerpolicy: 'strict-origin-when-cross-origin',
    }));
    media.classList.add('is-playing');
    playing = () => {
      media.classList.remove('is-playing');
      media.replaceChildren(thumbBtn);
    };
  }

  // ---------- סינון ורשת ----------

  function renderGrid() {
    playing = null;
    const list = state.tricks.filter((t) =>
      (state.platform === 'all' || t.platform === state.platform) &&
      (state.cat === 'all' || t.category === state.cat));
    $('#grid').replaceChildren(...list.map(card));
    $('#shown-count').textContent = state.tricks.length ? `מציג ${list.length} מתוך ${state.tricks.length}` : '';
    const empty = $('#empty');
    empty.hidden = list.length > 0;
    empty.textContent = state.tricks.length
      ? 'אין השבוע טריקים בשילוב הזה. נסו קטגוריה או פלטפורמה אחרת.'
      : 'הבוט עוד לא העלה טריקים לשבוע הזה. הסריקה הבאה ביום ראשון לפנות בוקר.';
  }

  function chip(label, pressed, onclick) {
    return h('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), text: label, onclick });
  }

  function renderCats() {
    const present = CATS.filter((c) => state.tricks.some((t) => t.category === c));
    const group = $('#cat-group');
    const label = group.querySelector('.filter-label');
    const chips = [['all', 'הכל'], ...present.map((c) => [c, c])].map(([value, text]) =>
      chip(text, state.cat === value, () => {
        state.cat = value;
        renderCats();
        renderGrid();
      }));
    group.replaceChildren(label, ...chips);
  }

  document.querySelectorAll('[data-platform]').forEach((b) => {
    if (b.tagName !== 'BUTTON') return;
    b.addEventListener('click', () => {
      state.platform = b.dataset.platform;
      document.querySelectorAll('button[data-platform]').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
      });
      renderGrid();
    });
  });

  // ---------- נתונים ----------

  function validTrick(t) {
    return t && PLATFORMS[t.platform] && typeof t.title === 'string' && t.title.trim();
  }

  function setConn(id, stateName, text) {
    const li = $(id);
    li.dataset.state = stateName;
    li.querySelector('.conn-state').textContent = text;
  }

  function render(data) {
    state.tricks = (data.tricks || []).filter(validTrick);
    const from = parseDay(data.from);
    const to = parseDay(data.to);

    if (archiveWeek) {
      $('#tricks-title').textContent = from ? `הטריקים של ${dm(from)} – ${dm(to)}` : 'שבוע מהארכיון';
      $('#back-link').hidden = false;
    }
    $('#week-num').textContent = from ? `WEEK ${isoWeek(from)}` : 'THIS WEEK';
    const hasYt = state.tricks.some((t) => t.platform === 'youtube');
    const hasTt = state.tricks.some((t) => t.platform === 'tiktok');
    const where = hasYt && hasTt ? 'מ-TikTok ומ-YouTube Shorts' : hasTt ? 'מ-TikTok' : 'מ-YouTube Shorts';
    $('#tricks-sub').textContent = from
      ? `השבוע של ${dm(from)} – ${dm(to)} · ${state.tricks.length} טריקים ${where}`
      : 'הבוט עוד לא סיים את הסריקה הראשונה שלו.';

    const ran = data.generatedAt ? new Date(data.generatedAt) : null;
    $('#stat-last').textContent = ran && !isNaN(ran) ? whenFmt.format(ran) : 'עוד לא רץ';
    $('#stat-scanned').textContent = Number.isFinite(data.scanned) ? String(data.scanned) : '—';
    $('#stat-count').textContent = String(state.tricks.length);

    const src = data.sources || {};
    if (demo) {
      setConn('#conn-youtube', 'warn', 'מצב דוגמה');
      setConn('#conn-tiktok', 'warn', 'מצב דוגמה');
    } else if (!ran) {
      setConn('#conn-youtube', 'off', 'עוד לא רץ');
      setConn('#conn-tiktok', 'off', 'עוד לא רץ');
    } else {
      const yt = src.youtube || {};
      if (yt.ok && yt.mode === 'links') setConn('#conn-youtube', 'ok', 'קישורים ידניים');
      else if (yt.ok) setConn('#conn-youtube', 'ok', 'מחובר');
      else if (yt.reason === 'no-key') setConn('#conn-youtube', 'warn', 'חסר מפתח API');
      else setConn('#conn-youtube', 'err', 'הסריקה נכשלה');
      const tt = src.tiktok || {};
      if (tt.mode === 'research') setConn('#conn-tiktok', 'ok', 'מחובר');
      else if (tt.mode === 'links') setConn('#conn-tiktok', 'ok', 'קישורים ידניים');
      else setConn('#conn-tiktok', 'off', 'לא מחובר');
    }

    renderCats();
    renderGrid();
  }

  function renderArchive(weeks) {
    const list = $('#archive-list');
    const valid = (Array.isArray(weeks) ? weeks : []).filter((w) => w && /^\d{4}-\d{2}-\d{2}$/.test(w.week));
    if (!valid.length) {
      list.replaceChildren(h('li', { class: 'muted', text: 'הארכיון יתמלא אחרי הסריקה הראשונה של הבוט.' }));
      return;
    }
    const current = archiveWeek || valid[0].week;
    list.replaceChildren(...valid.map((w) => {
      const from = parseDay(w.from);
      const to = parseDay(w.to);
      return h('li', null, h('a', {
        class: 'panel',
        href: `?week=${w.week}#tricks`,
        'aria-current': w.week === current ? 'page' : null,
      }, [
        h('span', { text: from ? `שבוע ${isoWeek(from)}` : w.week }),
        h('span', { class: 'archive-dates', text: from ? `${dm(from)} – ${dm(to)}` : '' }),
        h('span', { class: 'archive-count', text: Number.isFinite(w.count) ? `${w.count} טריקים` : '' }),
      ]));
    }));
  }

  function showNotice(text) {
    const n = $('#notice');
    n.textContent = text;
    n.hidden = false;
  }

  const source = demo ? 'data/demo.json' : archiveWeek ? `data/weeks/${archiveWeek}.json` : 'data/latest.json';
  if (demo) showNotice('מצב דוגמה: הטריקים כאן הם רק להמחשה, והכפתורים פותחים חיפוש ב-YouTube או ב-TikTok.');

  fetch(source, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(render)
    .catch(() => {
      render({ tricks: [] });
      showNotice(archiveWeek ? 'לא מצאתי את השבוע הזה בארכיון.' : 'לא הצלחתי לטעון את הטריקים. נסו לרענן את העמוד.');
    });

  fetch('data/weeks.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : []))
    .then(renderArchive)
    .catch(() => renderArchive([]));
})();
