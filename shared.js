// Settings, languages and style helpers shared by the popup and the overlay.

// code: our id · yt: YouTube caption code · wikt: Wiktionary language code
// section: Wiktionary heading (defaults to name) · sample: preview sentence
const DS_LANGS = [
  { code: "en", yt: "en", wikt: "en", name: "English", sample: "Where are you going tonight?" },
  { code: "fr", yt: "fr", wikt: "fr", name: "French", sample: "Où vas-tu ce soir ?" },
  { code: "es", yt: "es", wikt: "es", name: "Spanish", sample: "¿Adónde vas esta noche?" },
  { code: "de", yt: "de", wikt: "de", name: "German", sample: "Wohin gehst du heute Abend?" },
  { code: "it", yt: "it", wikt: "it", name: "Italian", sample: "Dove vai stasera?" },
  { code: "pt", yt: "pt", wikt: "pt", name: "Portuguese", sample: "Aonde você vai hoje à noite?" },
  { code: "nl", yt: "nl", wikt: "nl", name: "Dutch", sample: "Waar ga je vanavond heen?" },
  { code: "sv", yt: "sv", wikt: "sv", name: "Swedish", sample: "Vart ska du i kväll?" },
  { code: "da", yt: "da", wikt: "da", name: "Danish", sample: "Hvor skal du hen i aften?" },
  { code: "nb", yt: "no", wikt: "nb", name: "Norwegian", section: "Norwegian Bokmål", sample: "Hvor skal du i kveld?" },
  { code: "fi", yt: "fi", wikt: "fi", name: "Finnish", sample: "Minne olet menossa tänä iltana?" },
  { code: "pl", yt: "pl", wikt: "pl", name: "Polish", sample: "Dokąd idziesz dziś wieczorem?" },
  { code: "cs", yt: "cs", wikt: "cs", name: "Czech", sample: "Kam jdeš dnes večer?" },
  { code: "ro", yt: "ro", wikt: "ro", name: "Romanian", sample: "Unde mergi în seara asta?" },
  { code: "hu", yt: "hu", wikt: "hu", name: "Hungarian", sample: "Hová mész ma este?" },
  { code: "el", yt: "el", wikt: "el", name: "Greek", sample: "Πού πας απόψε;" },
  { code: "tr", yt: "tr", wikt: "tr", name: "Turkish", sample: "Bu akşam nereye gidiyorsun?" },
  { code: "ru", yt: "ru", wikt: "ru", name: "Russian", sample: "Куда ты идёшь сегодня вечером?" },
  { code: "uk", yt: "uk", wikt: "uk", name: "Ukrainian", sample: "Куди ти йдеш сьогодні ввечері?" },
  { code: "ar", yt: "ar", wikt: "ar", name: "Arabic", sample: "إلى أين أنت ذاهب الليلة؟" },
  { code: "he", yt: "iw", wikt: "he", name: "Hebrew", sample: "לאן אתה הולך הערב?" },
  { code: "fa", yt: "fa", wikt: "fa", name: "Persian", sample: "امشب کجا می‌روی؟" },
  { code: "hi", yt: "hi", wikt: "hi", name: "Hindi", sample: "आज रात तुम कहाँ जा रहे हो?" },
  { code: "bn", yt: "bn", wikt: "bn", name: "Bengali", sample: "আজ রাতে তুমি কোথায় যাচ্ছ?" },
  { code: "id", yt: "id", wikt: "id", name: "Indonesian", sample: "Kamu mau ke mana malam ini?" },
  { code: "ms", yt: "ms", wikt: "ms", name: "Malay", sample: "Awak nak ke mana malam ini?" },
  { code: "vi", yt: "vi", wikt: "vi", name: "Vietnamese", sample: "Tối nay bạn đi đâu?" },
  { code: "th", yt: "th", wikt: "th", name: "Thai", sample: "คืนนี้คุณจะไปไหน" },
  { code: "zh-Hans", yt: "zh-Hans", wikt: "zh", name: "Chinese (Simplified)", section: "Chinese", tts: "zh-CN", sample: "你今晚去哪儿？" },
  { code: "zh-Hant", yt: "zh-Hant", wikt: "zh", name: "Chinese (Traditional)", section: "Chinese", tts: "zh-TW", sample: "你今晚去哪裡？" },
  { code: "ja", yt: "ja", wikt: "ja", name: "Japanese", sample: "今夜どこへ行くの？" },
  { code: "ko", yt: "ko", wikt: "ko", name: "Korean", sample: "오늘 밤 어디 가?" }
];

function dsLang(code) {
  const l = DS_LANGS.find((x) => x.code === code) || DS_LANGS[0];
  return { section: l.name, tts: l.code, ...l };
}

const DS_DEFAULTS = {
  enabled: true,
  lang1: "fr",
  lang2: "en",
  show1: true,
  show2: true,
  hideNative: true,

  l1Color: "#ffffff", l1Bold: true,  l1Italic: false, l1Size: 22, l1Font: "sans",
  l2Color: "#ffe39a", l2Bold: false, l2Italic: false, l2Size: 22, l2Font: "sans",

  bgColor: "#080808",
  bgOpacity: 72,
  textOutline: false,
  raise: 0,

  wordLookup: true,
  pauseOnHover: true,
  showExamples: true,
  showSynonyms: true,

  voiceOn: false,          // read one subtitle line aloud
  voiceLine: "1",          // "1" = top line, "2" = bottom line
  voiceNames: {},          // chosen voice per language code ("" = automatic)
  voiceRate: 1,
  voiceDuck: 25,           // original audio volume (%) while the voice speaks
  voicePauseBehind: true
};

// Settings from versions before language choice (French on top by default).
const DS_OLD_KEYS = {
  frColor: "l1Color", frBold: "l1Bold", frItalic: "l1Italic", frSize: "l1Size", frFont: "l1Font",
  enColor: "l2Color", enBold: "l2Bold", enItalic: "l2Italic", enSize: "l2Size", enFont: "l2Font",
  showFr: "show1", showEn: "show2"
};

function dsLoad(cb) {
  chrome.storage.sync.get(null, (raw) => {
    const s = { ...DS_DEFAULTS };
    if (!("lang1" in raw)) {
      for (const [o, n] of Object.entries(DS_OLD_KEYS)) if (o in raw) s[n] = raw[o];
      if (raw.enFirst) {  // English was on top: move it to line 1 with its style
        s.lang1 = "en"; s.lang2 = "fr";
        for (const k of ["Color", "Bold", "Italic", "Size", "Font"]) {
          [s["l1" + k], s["l2" + k]] = [s["l2" + k], s["l1" + k]];
        }
        [s.show1, s.show2] = [s.show2, s.show1];
      }
    }
    for (const k in DS_DEFAULTS) if (k in raw) s[k] = raw[k];
    s.voiceNames = { ...(s.voiceNames || {}) };
    s.voiceLine = String(s.voiceLine);
    cb(s);
  });
}

const DS_FONTS = {
  sans:    { label: "Sans-serif", css: '"YouTube Noto", Roboto, Arial, sans-serif' },
  serif:   { label: "Serif",      css: 'Georgia, "Times New Roman", serif' },
  rounded: { label: "Rounded",    css: '"Arial Rounded MT Bold", "Varela Round", Nunito, system-ui, sans-serif' },
  mono:    { label: "Monospace",  css: 'Consolas, Menlo, "Courier New", monospace' },
  casual:  { label: "Casual",     css: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive' }
};

function dsRgba(hex, alpha) {
  const n = parseInt(String(hex).replace("#", ""), 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function dsStyleVars(s, scale = 1) {
  const vars = {
    "--ds-bg": dsRgba(s.bgColor, s.bgOpacity / 100),
    "--ds-shadow": s.textOutline ? "0 0 2px #000, 0 0 3px #000, 1px 1px 2px #000" : "none",
    "--ds-raise": s.raise + "%"
  };
  for (const p of ["l1", "l2"]) {
    vars[`--ds-${p}-color`] = s[p + "Color"];
    vars[`--ds-${p}-weight`] = s[p + "Bold"] ? "700" : "400";
    vars[`--ds-${p}-style`] = s[p + "Italic"] ? "italic" : "normal";
    vars[`--ds-${p}-size`] = Math.round(s[p + "Size"] * scale) + "px";
    vars[`--ds-${p}-font`] = (DS_FONTS[s[p + "Font"]] || DS_FONTS.sans).css;
  }
  return vars;
}

function dsApplyVars(el, vars) {
  for (const k in vars) el.style.setProperty(k, vars[k]);
}
