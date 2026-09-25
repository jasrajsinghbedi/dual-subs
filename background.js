// Looks words up on Wiktionary (and Datamuse for extra English synonyms).
// Runs in the extension's background so requests aren't blocked by
// YouTube's page security rules.
const HEADERS = { "Api-User-Agent": "DualSubsExtension/1.2" };
const defCache = new Map();
const synCache = new Map();
const DEF_API = "https://en.wiktionary.org/api/rest_v1/page/definition/";
const PARSE_API = "https://en.wiktionary.org/w/api.php?action=parse&format=json" +
  "&formatversion=2&prop=wikitext&redirects=1&page=";
const LANG_NAMES = { en: "English", fr: "French" };

async function define(word) {
  if (defCache.has(word)) return defCache.get(word);
  let data = null;
  for (const w of new Set([word, word.toLowerCase()])) {
    try {
      const res = await fetch(DEF_API + encodeURIComponent(w), { headers: HEADERS });
      if (res.ok) { data = await res.json(); break; }
    } catch (_) {
      return null; // network error: don't cache, allow a retry
    }
  }
  defCache.set(word, data);
  return data;
}

// ---------- synonyms ----------
async function wikitext(word) {
  const res = await fetch(PARSE_API + encodeURIComponent(word), { headers: HEADERS });
  if (!res.ok) return null;
  const json = await res.json();
  return (json.parse && json.parse.wikitext) || null;
}

function langSection(wt, langName) {
  const m = wt.match(new RegExp("^==\\s*" + langName + "\\s*==\\s*$", "m"));
  if (!m) return "";
  const rest = wt.slice(m.index + m[0].length);
  const next = rest.search(/^==[^=]/m);
  return next === -1 ? rest : rest.slice(0, next);
}

function cleanTerm(s) {
  return s
    .replace(/<[^>]*>/g, "")                                  // inline qualifiers like <q:informal>
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")          // [[link|text]] -> text
    .replace(/'''?/g, "")
    .trim();
}

function extractSynonyms(section, code) {
  const out = [];
  const add = (v) => {
    v = cleanTerm(v);
    if (v && !v.includes(":") && !v.includes("=") && v.length < 40) out.push(v);
  };
  const addParams = (s) => s.split("|").forEach((p) => { if (!p.includes("=")) add(p); });

  // Inline {{syn|fr|a|b}} templates under definitions
  const synT = new RegExp("\\{\\{(?:syn|synonyms)\\|" + code + "\\|([^{}]*)\\}\\}", "g");
  for (const m of section.matchAll(synT)) addParams(m[1]);

  // ====Synonyms==== sections
  const headRe = /^=+\s*Synonyms\s*=+\s*$/gm;
  let h;
  while ((h = headRe.exec(section))) {
    const rest = section.slice(h.index + h[0].length);
    const end = rest.search(/^=/m);
    const body = end === -1 ? rest : rest.slice(0, end);
    for (const m of body.matchAll(new RegExp("\\{\\{(?:l|link)\\|" + code + "\\|([^|{}]*)", "g"))) add(m[1]);
    for (const m of body.matchAll(new RegExp("\\{\\{col[^|{}]*\\|" + code + "\\|([^{}]*)\\}\\}", "g"))) addParams(m[1]);
    for (const m of body.matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)) add(m[1]);
  }
  return out;
}

async function datamuse(word) {
  const res = await fetch("https://api.datamuse.com/words?max=10&rel_syn=" + encodeURIComponent(word));
  if (!res.ok) return [];
  return (await res.json()).map((r) => r.word);
}

async function synonyms(word, lang) {
  const key = lang + "|" + word;
  if (synCache.has(key)) return synCache.get(key);
  let list = [];
  try {
    for (const w of new Set([word, word.toLowerCase()])) {
      const wt = await wikitext(w);
      if (wt) { list = extractSynonyms(langSection(wt, LANG_NAMES[lang]), lang); break; }
    }
    if (lang === "en" && list.length < 8) {
      try { list = list.concat(await datamuse(word.toLowerCase())); } catch (_) {}
    }
  } catch (_) {
    return null; // network error: don't cache
  }
  const seen = new Set([word.toLowerCase()]);
  list = list.filter((s) => {
    const k = s.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 10);
  synCache.set(key, list);
  return list;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "define") {
    define(msg.word).then(sendResponse);
    return true;
  }
  if (msg.type === "synonyms") {
    synonyms(msg.word, msg.lang).then(sendResponse);
    return true;
  }
});
