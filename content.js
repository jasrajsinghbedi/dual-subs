// Fetches English and French versions of the current video's captions,
// draws them over the player, and shows word definitions on hover.

const DEFAULTS = {
  enabled: true,
  showEn: true,
  showFr: true,
  frFirst: false,
  hideNative: true,
  fontSize: 22,
  wordLookup: true,
  pauseOnHover: true,
  showExamples: true,
  showSynonyms: true
};

let settings = { ...DEFAULTS };
let state = { videoId: null, en: [], fr: [], key: null };
let autoClickedFor = null;
let overlay = null, lineEn = null, lineFr = null, tip = null;
let lastEn = null, lastFr = null;

// ---------- settings ----------
chrome.storage.sync.get(DEFAULTS, (s) => { settings = s; applySettings(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const k in changes) settings[k] = changes[k].newValue;
  applySettings();
});

function applySettings() {
  if (!overlay) return;
  overlay.style.setProperty("--dualsubs-size", settings.fontSize + "px");
  overlay.classList.toggle("dualsubs-fr-first", !!settings.frFirst);
  overlay.classList.toggle("dualsubs-lookup-off", !settings.wordLookup);
  lineEn.hidden = !settings.showEn;
  lineFr.hidden = !settings.showFr;
  if (!settings.wordLookup) leaveZone(true);
}

// ---------- helpers ----------
function currentVideoId() {
  return new URL(location.href).searchParams.get("v");
}
function getVideo() {
  return document.querySelector("#movie_player video");
}

function parseJson3(data) {
  return (data.events || [])
    .filter((ev) => ev.segs)
    .map((ev) => {
      const start = ev.tStartMs || 0;
      return {
        start,
        end: start + (ev.dDurationMs || 0),
        text: ev.segs.map((s) => s.utf8 || "").join("").trim()
      };
    })
    .filter((c) => c.text);
}

async function fetchTrack(baseUrl, srcLang, target) {
  const u = new URL(baseUrl);
  u.searchParams.set("fmt", "json3");
  if (srcLang.split("-")[0] === target) {
    u.searchParams.delete("tlang");          // original track already in this language
  } else {
    u.searchParams.set("tlang", target);     // ask YouTube to auto-translate
  }
  const res = await fetch(u.href, { credentials: "include" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  return text ? parseJson3(JSON.parse(text)) : [];
}

function textAt(cues, ms) {
  const active = [];
  for (const c of cues) {
    if (c.start > ms) break;
    if (ms < c.end) active.push(c.text);
  }
  return active.slice(-2).join("\n");
}

// ---------- caption capture ----------
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.source !== "dualsubs") return;
  if (e.data.type === "timedtext") handleTimedtext(e.data.url);
});

async function handleTimedtext(rawUrl) {
  const u = new URL(rawUrl);
  const vid = u.searchParams.get("v");
  if (!vid || vid !== currentVideoId()) return;

  const lang = (u.searchParams.get("lang") || "").toLowerCase();
  const key = vid + "|" + lang + "|" + (u.searchParams.get("kind") || "");
  if (key === state.key) return;
  state.key = key;

  const [en, fr] = await Promise.allSettled([
    fetchTrack(u.href, lang, "en"),
    fetchTrack(u.href, lang, "fr")
  ]);
  if (currentVideoId() !== vid) return;

  state.videoId = vid;
  state.en = en.status === "fulfilled" ? en.value : [];
  state.fr = fr.status === "fulfilled" ? fr.value : [];
  if (!state.en.length && !state.fr.length) state.key = null; // allow a retry
}

// ---------- overlay ----------
function ensureOverlay() {
  const player = document.querySelector("#movie_player");
  if (!player) return false;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "dualsubs-overlay";
    lineEn = document.createElement("div");
    lineEn.className = "dualsubs-line dualsubs-en";
    lineEn.dataset.lang = "en";
    lineFr = document.createElement("div");
    lineFr.className = "dualsubs-line dualsubs-fr";
    lineFr.dataset.lang = "fr";
    overlay.append(lineEn, lineFr);

    tip = document.createElement("div");
    tip.className = "dualsubs-tip";
    tip.hidden = true;

    wireHover();
    applySettings();
  }
  if (overlay.parentElement !== player) player.append(overlay, tip);
  return true;
}

const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;

function renderLine(el, text) {
  el.replaceChildren();
  el.classList.toggle("dualsubs-empty", !text);
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (m.index > last) el.append(text.slice(last, m.index));
    if (/^\p{N}+$/u.test(m[0])) {
      el.append(m[0]);
    } else {
      const span = document.createElement("span");
      span.className = "dualsubs-word";
      span.textContent = m[0];
      el.append(span);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(text.slice(last));
}

function tick() {
  const vid = currentVideoId();
  const video = getVideo();
  const ready = settings.enabled && video && vid && state.videoId === vid;

  document.documentElement.classList.toggle(
    "dualsubs-hide-native", !!(ready && settings.hideNative)
  );

  if (ready && ensureOverlay()) {
    overlay.style.display = "";
    const ms = video.currentTime * 1000;
    const en = textAt(state.en, ms);
    const fr = textAt(state.fr, ms);
    if (en !== lastEn) { renderLine(lineEn, en); lastEn = en; }
    if (fr !== lastFr) { renderLine(lineFr, fr); lastFr = fr; }
  } else if (overlay) {
    overlay.style.display = "none";
    leaveZone(true);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Turn on YouTube's CC once per video so the player requests captions,
// which is what lets us capture the caption URL.
setInterval(() => {
  const vid = currentVideoId();
  if (!settings.enabled || !vid || state.videoId === vid || autoClickedFor === vid) return;
  const btn = document.querySelector(".ytp-subtitles-button");
  if (!btn || btn.offsetParent === null) return;
  autoClickedFor = vid;
  if (btn.getAttribute("aria-pressed") === "false") btn.click();
}, 1000);

// ---------- word lookup ----------
const lookupCache = new Map();
const FR_ELISION = /^(?:jusqu|lorsqu|puisqu|quoiqu|qu|l|d|j|m|n|s|t|c)['’]/i;
const FORM_OF_RE = /\b(plural|singular|participle|inflection|conjugation|feminine|masculine|indicative|subjunctive|imperative|conditional|tense|person)\b.*\bof\b/i;
const parser = new DOMParser();

function htmlText(html) {
  return parser.parseFromString(html || "", "text/html").body.textContent.replace(/\s+/g, " ").trim();
}

function parseExamples(d) {
  const parsed = (d.parsedExamples || [])
    .map((p) => ({ text: htmlText(p.example), tr: p.translation ? htmlText(p.translation) : null }));
  const list = parsed.length ? parsed : (d.examples || []).map((h) => ({ text: htmlText(h), tr: null }));
  return list.filter((e) => e.text).slice(0, 2);
}

function parseDefinition(html) {
  const doc = parser.parseFromString(html || "", "text/html");
  const text = doc.body.textContent.replace(/\s+/g, " ").trim();
  let link = doc.querySelector(".form-of-definition-link a, .form-of-definition a");
  if (!link && FORM_OF_RE.test(text)) link = doc.querySelector("a");
  const base = link ? (link.getAttribute("title") || link.textContent || "").trim() : null;
  return { text, base: base || null };
}

async function getEntries(word, lang) {
  let data;
  try {
    data = await chrome.runtime.sendMessage({ type: "define", word });
  } catch (_) {
    return undefined; // extension reloaded or offline
  }
  const list = data && data[lang];
  if (!list || !list.length) return null;
  return list
    .map((e) => ({
      pos: e.partOfSpeech,
      defs: (e.definitions || [])
        .map((d) => ({ ...parseDefinition(d.definition), examples: parseExamples(d) }))
        .filter((d) => d.text)
    }))
    .filter((e) => e.defs.length);
}

async function lookup(rawWord, lang) {
  let word = rawWord.replace(/’/g, "'");
  if (lang === "fr") word = word.replace(FR_ELISION, "") || word;
  const cacheKey = lang + "|" + word;
  if (lookupCache.has(cacheKey)) return lookupCache.get(cacheKey);

  let entries = await getEntries(word, lang);
  if (entries === undefined) return { word, error: true };
  if ((!entries || !entries.length) && word.includes("-")) {
    word = word.split("-")[0];
    entries = await getEntries(word, lang);
  }

  const result = { word, entries: entries && entries.length ? entries : null };

  // If every sense is just "form of X" (e.g. allons → aller), look up X too.
  if (result.entries) {
    const defs = result.entries.flatMap((e) => e.defs);
    const bases = defs.map((d) => d.base).filter(Boolean);
    if (bases.length && bases.length === defs.length &&
        bases[0].toLowerCase() !== word.toLowerCase()) {
      const baseEntries = await getEntries(bases[0], lang);
      if (baseEntries && baseEntries.length) {
        result.base = bases[0];
        result.formNote = defs[0].text;
        result.baseEntries = baseEntries;
      }
    }
  }
  lookupCache.set(cacheKey, result);
  return result;
}

// ---------- tooltip ----------
let hoverTimer = null, hideTimer = null, requestSeq = 0;
let activeWord = null, pausedByUs = false;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function positionTip(word) {
  const player = document.querySelector("#movie_player");
  if (!player || !word.isConnected) return;
  const pr = player.getBoundingClientRect();
  const wr = word.getBoundingClientRect();
  tip.style.bottom = (pr.bottom - wr.top + 8) + "px";
  const center = wr.left + wr.width / 2 - pr.left;
  const w = tip.offsetWidth;
  const left = Math.max(8, Math.min(center - w / 2, pr.width - w - 8));
  tip.style.left = left + "px";
}

function renderTip(result, lang) {
  const langName = lang === "fr" ? "French" : "English";
  tip.replaceChildren();

  const head = el("div", "dualsubs-tip-head");
  head.append(el("strong", null, result.word), el("span", "dualsubs-tip-lang", langName));
  tip.append(head);

  if (result.error) {
    tip.append(el("p", "dualsubs-tip-msg", "Couldn't reach Wiktionary. Check your connection and hover again."));
    return;
  }
  if (!result.entries) {
    tip.append(el("p", "dualsubs-tip-msg", `No ${langName} entry for “${result.word}” on Wiktionary.`));
    return;
  }

  let entries = result.entries;
  if (result.baseEntries) {
    tip.append(el("p", "dualsubs-tip-form", result.formNote));
    entries = result.baseEntries;
  }

  for (const e of entries.slice(0, 3)) {
    tip.append(el("div", "dualsubs-tip-pos", e.pos));
    const ol = el("ol");
    for (const d of e.defs.slice(0, 3)) {
      const li = el("li");
      li.append(el("span", null, d.text));
      if (settings.showExamples) {
        for (const ex of d.examples.slice(0, 1)) {
          li.append(el("div", "dualsubs-tip-ex", ex.text));
          if (ex.tr) li.append(el("div", "dualsubs-tip-tr", ex.tr));
        }
      }
      ol.append(li);
    }
    tip.append(ol);
  }

  if (settings.showSynonyms) {
    const label = result.base ? "Synonyms of " + result.base : "Synonyms";
    tip.append(el("div", "dualsubs-tip-pos", label));
    if (result.synonyms === undefined) {
      tip.append(el("p", "dualsubs-tip-msg dualsubs-tip-small", "Finding synonyms…"));
    } else if (result.synonyms === null) {
      tip.append(el("p", "dualsubs-tip-msg dualsubs-tip-small", "Couldn't load synonyms."));
    } else if (!result.synonyms.length) {
      tip.append(el("p", "dualsubs-tip-msg dualsubs-tip-small", "None listed on Wiktionary."));
    } else {
      const wrap = el("div", "dualsubs-tip-syns");
      for (const syn of result.synonyms) wrap.append(el("span", "dualsubs-tip-syn", syn));
      tip.append(wrap);
    }
  }

  const page = result.base || result.word;
  const a = el("a", "dualsubs-tip-more", "More on Wiktionary");
  a.href = "https://en.wiktionary.org/wiki/" + encodeURIComponent(page) + "#" + langName;
  a.target = "_blank";
  a.rel = "noopener";
  tip.append(a);
}

async function showFor(word) {
  const lang = word.closest(".dualsubs-line").dataset.lang;
  const seq = ++requestSeq;
  document.querySelectorAll(".dualsubs-word.dualsubs-active")
    .forEach((w) => w.classList.remove("dualsubs-active"));
  word.classList.add("dualsubs-active");

  tip.replaceChildren(el("p", "dualsubs-tip-msg", "Looking up “" + word.textContent + "”…"));
  tip.hidden = false;
  positionTip(word);

  const result = await lookup(word.textContent, lang);
  if (seq !== requestSeq || tip.hidden) return;
  const view = { ...result, synonyms: undefined };
  renderTip(view, lang);
  tip.scrollTop = 0;
  positionTip(word);

  if (!settings.showSynonyms || !result.entries) return;
  view.synonyms = await getSynonyms(result.base || result.word, lang);
  if (seq !== requestSeq || tip.hidden) return;
  const scroll = tip.scrollTop;
  renderTip(view, lang);
  tip.scrollTop = scroll;
  positionTip(word);
}

const synonymCache = new Map();
async function getSynonyms(word, lang) {
  const key = lang + "|" + word;
  if (synonymCache.has(key)) return synonymCache.get(key);
  let list = null;
  try {
    list = await chrome.runtime.sendMessage({ type: "synonyms", word, lang });
  } catch (_) {}
  if (list) synonymCache.set(key, list);
  return list;
}

function enterZone() {
  clearTimeout(hideTimer);
  const video = getVideo();
  if (settings.pauseOnHover && video && !video.paused) {
    video.pause();
    pausedByUs = true;
  }
}

function leaveZone(now) {
  clearTimeout(hideTimer);
  clearTimeout(hoverTimer);
  const finish = () => {
    requestSeq++;
    activeWord = null;
    if (tip) tip.hidden = true;
    document.querySelectorAll(".dualsubs-word.dualsubs-active")
      .forEach((w) => w.classList.remove("dualsubs-active"));
    const video = getVideo();
    if (pausedByUs && video) video.play().catch(() => {});
    pausedByUs = false;
  };
  if (now === true) finish(); else hideTimer = setTimeout(finish, 300);
}

function wireHover() {
  for (const line of [lineEn, lineFr]) {
    line.addEventListener("mouseenter", () => { if (settings.wordLookup) enterZone(); });
    line.addEventListener("mouseleave", () => leaveZone());
    // Keep clicks on subtitles from pausing or fullscreening the video.
    for (const t of ["click", "dblclick", "mousedown"]) {
      line.addEventListener(t, (e) => e.stopPropagation());
    }
  }
  tip.addEventListener("mouseenter", enterZone);
  tip.addEventListener("mouseleave", () => leaveZone());
  for (const t of ["click", "dblclick", "mousedown", "wheel"]) {
    tip.addEventListener(t, (e) => e.stopPropagation());
  }

  overlay.addEventListener("mouseover", (e) => {
    if (!settings.wordLookup) return;
    const word = e.target.closest(".dualsubs-word");
    if (!word || word === activeWord) return;
    activeWord = word;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showFor(word), 200);
  });
}
