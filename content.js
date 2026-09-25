// Fetches the current video's captions in the two chosen languages,
// draws them over the player, and shows word definitions on hover.

let settings = { ...DS_DEFAULTS };
let state = { videoId: null, lines: [[], []], key: null, url: null };
let autoClickedFor = null;
let overlay = null, line1 = null, line2 = null, tip = null;
let last1 = null, last2 = null;

// ---------- settings ----------
dsLoad((s) => { settings = s; applySettings(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const langChanged = "lang1" in changes || "lang2" in changes;
  for (const k in changes) if (k in DS_DEFAULTS) settings[k] = changes[k].newValue;
  applySettings();
  if (langChanged && state.url) handleTimedtext(state.url, true);
  if (langChanged || "voiceLine" in changes) { stopVoice(); voice.lastCue = null; }
  if ("voiceOn" in changes && currentVideoId()) {
    if (!settings.voiceOn) stopVoice();
    toast(settings.voiceOn
      ? "Voice-over on · " + dsLang(settings["lang" + settings.voiceLine]).name
      : "Voice-over off");
  }
});

function applySettings() {
  if (!overlay) return;
  dsApplyVars(overlay, dsStyleVars(settings));
  overlay.classList.toggle("dualsubs-lookup-off", !settings.wordLookup);
  line1.hidden = !settings.show1;
  line2.hidden = !settings.show2;
  if (line1.dataset.lang !== settings.lang1 || line2.dataset.lang !== settings.lang2) {
    line1.dataset.lang = settings.lang1;
    line2.dataset.lang = settings.lang2;
    line1.lang = dsLang(settings.lang1).code;
    line2.lang = dsLang(settings.lang2).code;
    last1 = last2 = null; // force re-render with the new word splitting
  }
  if (!settings.wordLookup) leaveZone(true);
  updateVoiceButton();
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

function sameLang(src, target) {
  const norm = (x) => x.toLowerCase().replace(/^iw(?=$|-)/, "he");
  const s = norm(src), t = norm(target);
  return t.includes("-") ? s === t : s.split("-")[0] === t;
}

async function fetchTrack(baseUrl, srcLang, target) {
  const u = new URL(baseUrl);
  u.searchParams.set("fmt", "json3");
  if (sameLang(srcLang, target)) {
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

async function handleTimedtext(rawUrl, force) {
  const u = new URL(rawUrl);
  const vid = u.searchParams.get("v");
  if (!vid || vid !== currentVideoId()) return;
  state.url = rawUrl;

  const src = u.searchParams.get("lang") || "";
  const key = [vid, src, u.searchParams.get("kind") || "", settings.lang1, settings.lang2].join("|");
  if (!force && key === state.key) return;
  state.key = key;

  const targets = [dsLang(settings.lang1).yt, dsLang(settings.lang2).yt];
  const results = await Promise.allSettled(targets.map((t) => fetchTrack(u.href, src, t)));
  if (currentVideoId() !== vid || state.key !== key) return;

  state.videoId = vid;
  state.lines = results.map((r) => (r.status === "fulfilled" ? r.value : []));
  last1 = last2 = null;
  if (!state.lines[0].length && !state.lines[1].length) state.key = null; // allow a retry
}

// ---------- overlay ----------
function ensureOverlay() {
  const player = document.querySelector("#movie_player");
  if (!player) return false;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "dualsubs-overlay";
    line1 = document.createElement("div");
    line1.className = "dualsubs-line dualsubs-line1";
    line2 = document.createElement("div");
    line2.className = "dualsubs-line dualsubs-line2";
    line1.dir = line2.dir = "auto";
    overlay.append(line1, line2);

    tip = document.createElement("div");
    tip.className = "dualsubs-tip";
    tip.dir = "auto";
    tip.hidden = true;

    wireHover();
    applySettings();
  }
  if (overlay.parentElement !== player) player.append(overlay, tip);
  return true;
}

const segmenters = new Map();
function segmenter(code) {
  if (!("Segmenter" in Intl)) return null;
  if (!segmenters.has(code)) segmenters.set(code, new Intl.Segmenter(code, { granularity: "word" }));
  return segmenters.get(code);
}
const WORD_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;

function wordPieces(text, code) {
  const seg = segmenter(code);
  if (seg) {
    return [...seg.segment(text)].map((p) => ({ text: p.segment, word: !!p.isWordLike }));
  }
  const out = [];
  let last = 0;
  for (const m of text.matchAll(WORD_RE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), word: false });
    out.push({ text: m[0], word: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), word: false });
  return out;
}

function renderLine(el, text) {
  el.replaceChildren();
  el.classList.toggle("dualsubs-empty", !text);
  for (const piece of wordPieces(text, el.lang || "en")) {
    if (piece.word && !/^\p{N}+$/u.test(piece.text)) {
      const span = document.createElement("span");
      span.className = "dualsubs-word";
      span.textContent = piece.text;
      el.append(span);
    } else {
      el.append(piece.text);
    }
  }
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
    const t1 = textAt(state.lines[0], ms);
    const t2 = textAt(state.lines[1], ms);
    if (t1 !== last1) { renderLine(line1, t1); last1 = t1; }
    if (t2 !== last2) { renderLine(line2, t2); last2 = t2; }
    voiceTick(video, ms, vid);
  } else if (overlay) {
    overlay.style.display = "none";
    leaveZone(true);
    if (voice.speakingId != null || voice.duckedFrom != null) stopVoice();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Turn on YouTube's CC once per video so the player requests captions,
// which is what lets us capture the caption URL.
setInterval(() => {
  ensureVoiceButton();
  const vid = currentVideoId();
  if (!settings.enabled || !vid || state.videoId === vid || autoClickedFor === vid) return;
  const btn = document.querySelector(".ytp-subtitles-button");
  if (!btn || btn.offsetParent === null) return;
  autoClickedFor = vid;
  if (btn.getAttribute("aria-pressed") === "false") btn.click();
}, 1000);

// ---------- word lookup ----------
const lookupCache = new Map();
const ELISIONS = {
  fr: /^(?:jusqu|lorsqu|puisqu|quoiqu|qu|l|d|j|m|n|s|t|c)['’]/i,
  it: /^(?:dell|dall|nell|sull|all|quest|quell|l|d|c|m|t|s|v|un)['’]/i
};
const FORM_OF_RE = /\b(plural|singular|participle|inflection|conjugation|feminine|masculine|indicative|subjunctive|imperative|conditional|tense|person|genitive|dative|accusative|form)\b.*\bof\b/i;
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

async function getEntries(word, wikt) {
  let data;
  try {
    data = await chrome.runtime.sendMessage({ type: "define", word });
  } catch (_) {
    return undefined; // extension reloaded or offline
  }
  const list = data && data[wikt];
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

async function lookup(rawWord, code) {
  const L = dsLang(code);
  let word = rawWord.replace(/’/g, "'");
  if (ELISIONS[L.code]) word = word.replace(ELISIONS[L.code], "") || word;
  const cacheKey = L.code + "|" + word;
  if (lookupCache.has(cacheKey)) return lookupCache.get(cacheKey);

  let entries = await getEntries(word, L.wikt);
  if (entries === undefined) return { word, error: true };
  if ((!entries || !entries.length) && word.includes("-")) {
    word = word.split("-")[0];
    entries = await getEntries(word, L.wikt);
  }

  const result = { word, entries: entries && entries.length ? entries : null };

  // If every sense is just "form of X" (e.g. allons → aller), look up X too.
  if (result.entries) {
    const defs = result.entries.flatMap((e) => e.defs);
    const bases = defs.map((d) => d.base).filter(Boolean);
    if (bases.length && bases.length === defs.length &&
        bases[0].toLowerCase() !== word.toLowerCase()) {
      const baseEntries = await getEntries(bases[0], L.wikt);
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

const synonymCache = new Map();
async function getSynonyms(word, code) {
  const L = dsLang(code);
  const key = L.wikt + "|" + word;
  if (synonymCache.has(key)) return synonymCache.get(key);
  let list = null;
  try {
    list = await chrome.runtime.sendMessage({ type: "synonyms", word, wikt: L.wikt, section: L.section });
  } catch (_) {}
  if (list) synonymCache.set(key, list);
  return list;
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
  tip.style.left = Math.max(8, Math.min(center - w / 2, pr.width - w - 8)) + "px";
}

function renderTip(result, code) {
  const L = dsLang(code);
  tip.replaceChildren();

  const head = el("div", "dualsubs-tip-head");
  head.append(el("strong", null, result.word), el("span", "dualsubs-tip-lang", L.name));
  tip.append(head);

  if (result.error) {
    tip.append(el("p", "dualsubs-tip-msg", "Couldn't reach Wiktionary. Check your connection and hover again."));
    return;
  }
  if (!result.entries) {
    tip.append(el("p", "dualsubs-tip-msg", `No ${L.name} entry for “${result.word}” on Wiktionary.`));
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
    tip.append(el("div", "dualsubs-tip-pos", result.base ? "Synonyms of " + result.base : "Synonyms"));
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
  a.href = "https://en.wiktionary.org/wiki/" + encodeURIComponent(page) + "#" + L.section.replace(/ /g, "_");
  a.target = "_blank";
  a.rel = "noopener";
  tip.append(a);
}

async function showFor(word) {
  const code = word.closest(".dualsubs-line").dataset.lang;
  const seq = ++requestSeq;
  document.querySelectorAll(".dualsubs-word.dualsubs-active")
    .forEach((w) => w.classList.remove("dualsubs-active"));
  word.classList.add("dualsubs-active");

  tip.replaceChildren(el("p", "dualsubs-tip-msg", "Looking up “" + word.textContent + "”…"));
  tip.hidden = false;
  positionTip(word);

  const result = await lookup(word.textContent, code);
  if (seq !== requestSeq || tip.hidden) return;
  const view = { ...result, synonyms: undefined };
  renderTip(view, code);
  tip.scrollTop = 0;
  positionTip(word);

  if (!settings.showSynonyms || !result.entries) return;
  view.synonyms = await getSynonyms(result.base || result.word, code);
  if (seq !== requestSeq || tip.hidden) return;
  const scroll = tip.scrollTop;
  renderTip(view, code);
  tip.scrollTop = scroll;
  positionTip(word);
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
  for (const line of [line1, line2]) {
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

// ---------- voice-over ----------
// Reads the chosen subtitle line aloud with Chrome's text-to-speech and
// lowers the video's own sound while it speaks.
const voice = {
  seq: 0, speakingId: null, lastCue: null, queued: null, vid: null,
  duckedFrom: null, restoreTimer: null, watchdog: null,
  pausedByVoice: false, video: null, errorShown: new Set()
};

function activeCue(cues, ms) {
  let hit = null;
  for (const c of cues) {
    if (c.start > ms) break;
    if (ms < c.end) hit = c;
  }
  return hit;
}

function attachVideo(video) {
  if (voice.video === video) return;
  voice.video = video;
  video.addEventListener("pause", () => { if (!voice.pausedByVoice) stopVoice(); });
  video.addEventListener("seeking", () => { stopVoice(); voice.lastCue = null; });
}

function voiceTick(video, ms, vid) {
  if (voice.vid !== vid) { stopVoice(); voice.vid = vid; voice.lastCue = null; }
  if (!settings.voiceOn) return;
  attachVideo(video);
  if (video.paused || video.seeking) return;

  const cue = activeCue(state.lines[settings.voiceLine === "2" ? 1 : 0], ms);
  if (!cue || cue === voice.lastCue) return;
  voice.lastCue = cue;
  if (ms - cue.start > 1500) return; // joined partway through a line (e.g. after seeking)

  if (voice.speakingId != null && settings.voicePauseBehind) {
    voice.queued = cue;             // let the voice finish, then continue
    voice.pausedByVoice = true;
    video.pause();
    return;
  }
  speakCue(cue, video);
}

function speakCue(cue, video) {
  const code = settings["lang" + settings.voiceLine];
  const L = dsLang(code);
  const id = ++voice.seq;
  voice.speakingId = id;

  // Speed up (up to 1.5x the chosen speed) when a line is long for its time slot.
  const slot = Math.max(0.8, (cue.end - cue.start) / 1000);
  const needed = cue.text.length / 15;  // rough seconds at normal speed
  let rate = settings.voiceRate * (video.playbackRate || 1);
  if (needed / rate > slot) rate = Math.min(rate * 1.5, needed / slot);
  rate = Math.max(0.5, Math.min(2.5, rate));

  duck(video);
  clearTimeout(voice.watchdog);
  voice.watchdog = setTimeout(() => onVoiceDone(id, "timeout"), (needed / rate) * 2000 + 4000);

  chrome.runtime.sendMessage({
    type: "speak", id, text: cue.text.replace(/\n/g, " "),
    lang: L.tts, voiceName: (settings.voiceNames || {})[code] || "", rate
  }).catch(() => onVoiceDone(id, "error", "extension was reloaded"));
}

function onVoiceDone(id, reason, error) {
  if (id !== voice.speakingId) return;
  clearTimeout(voice.watchdog);
  voice.speakingId = null;
  const video = getVideo();

  if (reason === "error") {
    const L = dsLang(settings["lang" + settings.voiceLine]);
    if (!voice.errorShown.has(L.code)) {
      voice.errorShown.add(L.code);
      toast(`No ${L.name} voice available. Pick another voice or install one in your system settings.`, 5000);
    }
  }

  if (voice.queued && video) {
    const next = voice.queued;
    voice.queued = null;
    if (voice.pausedByVoice) {
      voice.pausedByVoice = false;
      video.play().catch(() => {});
    }
    speakCue(next, video);
  } else {
    if (voice.pausedByVoice && video) video.play().catch(() => {});
    voice.pausedByVoice = false;
    unduck(video, 300);
  }
}

function stopVoice() {
  clearTimeout(voice.watchdog);
  if (voice.speakingId != null || voice.queued) {
    chrome.runtime.sendMessage({ type: "stopSpeaking" }).catch(() => {});
  }
  voice.speakingId = null;
  voice.queued = null;
  voice.pausedByVoice = false;
  unduck(getVideo(), 0);
}

function duck(video) {
  clearTimeout(voice.restoreTimer);
  if (!video) return;
  if (voice.duckedFrom == null) voice.duckedFrom = video.volume;
  video.volume = voice.duckedFrom * (settings.voiceDuck / 100);
}

function unduck(video, delay) {
  clearTimeout(voice.restoreTimer);
  const restore = () => {
    if (voice.duckedFrom != null && video) video.volume = voice.duckedFrom;
    voice.duckedFrom = null;
  };
  if (delay) voice.restoreTimer = setTimeout(restore, delay); else restore();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "ttsDone") onVoiceDone(msg.id, msg.reason, msg.error);
});
window.addEventListener("pagehide", stopVoice);

// ---------- player button & toast ----------
let voiceBtn = null, toastEl = null, toastTimer = null;

function ensureVoiceButton() {
  const controls = document.querySelector("#movie_player .ytp-right-controls");
  if (!controls) return;
  if (!voiceBtn) {
    voiceBtn = document.createElement("button");
    voiceBtn.className = "ytp-button dualsubs-voice-btn";
    voiceBtn.innerHTML =
      '<svg viewBox="0 0 36 36" width="100%" height="100%" aria-hidden="true">' +
      '<path d="M9 15h4l5-4.5v15L13 21H9z" fill="#fff"/>' +
      '<path class="dualsubs-waves" d="M21.5 14.5a5 5 0 0 1 0 7M24.5 11.5a9 9 0 0 1 0 13" ' +
      'fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
      '<path class="dualsubs-slash" d="M22 15l6 6M28 15l-6 6" fill="none" stroke="#fff" ' +
      'stroke-width="2" stroke-linecap="round"/></svg>';
    for (const t of ["mousedown", "dblclick"]) voiceBtn.addEventListener(t, (e) => e.stopPropagation());
    voiceBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.storage.sync.set({ voiceOn: !settings.voiceOn });
    });
    updateVoiceButton();
  }
  if (voiceBtn.parentElement !== controls) controls.prepend(voiceBtn);
  voiceBtn.style.display = settings.enabled ? "" : "none";
}

function updateVoiceButton() {
  if (!voiceBtn) return;
  const on = !!settings.voiceOn;
  voiceBtn.setAttribute("aria-pressed", String(on));
  const label = (on ? "Turn off voice-over" : "Turn on voice-over") + " (Alt+Shift+V)";
  voiceBtn.setAttribute("aria-label", label);
  voiceBtn.title = label;
  voiceBtn.style.display = settings.enabled ? "" : "none";
}

function toast(text, ms = 2200) {
  const player = document.querySelector("#movie_player");
  if (!player) return;
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "dualsubs-toast";
    toastEl.setAttribute("role", "status");
  }
  if (toastEl.parentElement !== player) player.append(toastEl);
  toastEl.textContent = text;
  toastEl.classList.add("dualsubs-toast-show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("dualsubs-toast-show"), ms);
}
