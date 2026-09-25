const $ = (id) => document.getElementById(id);
const TEXT_COLORS = [
  "#ffffff", "#ffe39a", "#ffd000", "#ffb366", "#ff8a80", "#ffb3d1",
  "#d9b3ff", "#8fe3ff", "#7fb2ff", "#a8f0a0", "#c8c8c8", "#000000"
];
const BOX_COLORS = [
  "#080808", "#1c2130", "#0d2b45", "#2b0d1a", "#1f3320", "#444444",
  "#ffffff", "#fff4d6", "#e8f4ff", "#ffe39a", "#8fe3ff", "#ffb3d1"
];
const HEX_RE = /^#?([0-9a-f]{6})$/i;

// A palette of swatches plus a hex field, built inside the popup so it never
// opens a system dialog (which can close the extension popup).
function colorBlock(key, label, colors) {
  const swatches = colors
    .map((c) => `<button class="swatch" data-target="${key}" data-color="${c}" style="background:${c}" title="${c}" aria-label="${label} ${c}" aria-pressed="false"></button>`)
    .join("");
  return `
    <div class="color-block">
      <div class="label"><span>${label}</span><input class="hex" id="${key}" maxlength="7" spellcheck="false" aria-label="${label} hex code"></div>
      <div class="palette">${swatches}</div>
    </div>`;
}

function buildStyleSection(p) {
  const fontOptions = Object.entries(DS_FONTS)
    .map(([k, f]) => `<option value="${k}">${f.label}</option>`).join("");
  const body = document.createElement("div");
  body.className = "body";
  body.innerHTML = `
    ${colorBlock(p + "Color", "Text color", TEXT_COLORS)}
    <div class="row"><span>Emphasis</span>
      <div class="toggles">
        <button class="toggle" id="${p}Bold" aria-pressed="false" title="Bold"><b>B</b></button>
        <button class="toggle" id="${p}Italic" aria-pressed="false" title="Italic"><i>I</i></button>
      </div>
    </div>
    <div class="row"><span>Size</span>
      <div class="range"><input type="range" id="${p}Size" min="14" max="48" step="1"><span class="val" id="${p}SizeVal"></span></div>
    </div>
    <div class="row"><span>Font</span><select id="${p}Font">${fontOptions}</select></div>`;
  $("style-" + p).append(body);
}
buildStyleSection("l1");
buildStyleSection("l2");

const langOptions = DS_LANGS.map((l) => `<option value="${l.code}">${l.name}</option>`).join("");
$("lang1").innerHTML = langOptions;
$("lang2").innerHTML = langOptions;
$("bgColorSlot").innerHTML = colorBlock("bgColor", "Box color", BOX_COLORS);

function markSwatches() {
  document.querySelectorAll(".swatch").forEach((b) => {
    const on = String(s[b.dataset.target]).toLowerCase() === b.dataset.color;
    b.setAttribute("aria-pressed", String(on));
  });
  $("l1Chip").style.background = s.l1Color;
  $("l2Chip").style.background = s.l2Color;
}

let s = { ...DS_DEFAULTS };

// ---------- voices ----------
let allVoices = null;
chrome.tts.getVoices((v) => { allVoices = v || []; fillVoices(); });

function voiceLang() {
  return dsLang(s["lang" + s.voiceLine]);
}

function voiceMatches(v, L) {
  const vl = (v.lang || "").toLowerCase();
  const base = L.tts.toLowerCase().split("-")[0];
  const alts = { nb: ["nb", "no"], he: ["he", "iw"] }[base] || [base];
  return alts.some((a) => vl === a || vl.startsWith(a + "-") || vl.startsWith(a + "_"));
}

function fillVoices() {
  const sel = $("voiceSelect");
  if (!sel || !allVoices) return;
  const L = voiceLang();
  const region = L.tts.toLowerCase();
  const list = allVoices
    .filter((v) => voiceMatches(v, L))
    .sort((a, b) => ((b.lang || "").toLowerCase() === region) - ((a.lang || "").toLowerCase() === region));
  const current = s.voiceNames[L.code] || "";
  sel.replaceChildren();
  const auto = new Option(list.length ? "Automatic" : "Automatic (none found)", "");
  sel.append(auto);
  for (const v of list) {
    sel.append(new Option(v.voiceName + (v.lang ? " (" + v.lang + ")" : ""), v.voiceName));
  }
  sel.value = list.some((v) => v.voiceName === current) ? current : "";
  $("voiceHint").textContent = list.length
    ? "Shortcut: Alt+Shift+V, or the speaker button in the YouTube player."
    : "No " + L.name + " voice was found. Install one in your system's language settings.";
}


function fillControls() {
  for (const key in DS_DEFAULTS) {
    const el = $(key);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = s[key];
    else if (el.classList.contains("toggle")) el.setAttribute("aria-pressed", String(s[key]));
    else el.value = s[key];
  }
}

function render() {
  const p = $("preview");
  dsApplyVars(p, dsStyleVars(s, 0.62));
  p.classList.toggle("off", !s.enabled);
  const L1 = dsLang(s.lang1), L2 = dsLang(s.lang2);
  $("p1").textContent = L1.sample;
  $("p2").textContent = L2.sample;
  $("p1").hidden = !s.show1;
  $("p2").hidden = !s.show2;
  $("l1Title").textContent = "Top line style · " + L1.name;
  $("l2Title").textContent = "Bottom line style · " + L2.name;
  $("l1SizeVal").textContent = s.l1Size + "px";
  $("l2SizeVal").textContent = s.l2Size + "px";
  $("bgOpacityVal").textContent = s.bgOpacity + "%";
  $("raiseVal").textContent = s.raise + "%";
  $("vl1").textContent = "Top line · " + L1.name;
  $("vl2").textContent = "Bottom line · " + L2.name;
  $("voiceRateVal").textContent = Number(s.voiceRate).toFixed(1) + "×";
  $("voiceDuckVal").textContent = s.voiceDuck + "%";
  fillVoices();
  markSwatches();
}

let saveTimer = null;
function save() {
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.sync.set(s), 150); // stay under sync write limits
}

dsLoad((stored) => {
  s = stored;
  fillControls();
  render();

  for (const key in DS_DEFAULTS) {
    const el = $(key);
    if (!el) continue;
    if (el.type === "checkbox") {
      el.addEventListener("change", () => { s[key] = el.checked; save(); });
    } else if (el.classList.contains("toggle")) {
      el.addEventListener("click", () => {
        s[key] = !s[key];
        el.setAttribute("aria-pressed", String(s[key]));
        save();
      });
    } else if (el.type === "range") {
      el.addEventListener("input", () => { s[key] = Number(el.value); save(); });
    } else if (el.classList.contains("hex")) {
      el.addEventListener("input", () => {
        const m = el.value.trim().match(HEX_RE);
        el.classList.toggle("bad", !m && el.value.trim() !== "");
        if (m) { s[key] = "#" + m[1].toLowerCase(); save(); }
      });
      el.addEventListener("blur", () => { el.value = s[key]; el.classList.remove("bad"); });
    } else {
      el.addEventListener("input", () => { s[key] = el.value; save(); });
    }
  }

  document.querySelectorAll(".swatch").forEach((b) => {
    b.addEventListener("click", () => {
      s[b.dataset.target] = b.dataset.color;
      $(b.dataset.target).value = b.dataset.color;
      save();
    });
  });

  $("voiceSelect").addEventListener("change", () => {
    const code = voiceLang().code;
    s.voiceNames = { ...s.voiceNames, [code]: $("voiceSelect").value };
    save();
  });

  $("testVoice").addEventListener("click", () => {
    const L = voiceLang();
    const name = s.voiceNames[L.code] || "";
    const opts = {
      rate: s.voiceRate,
      onEvent: (ev) => {
        if (ev.type === "error") $("voiceHint").textContent = "No " + L.name + " voice could be played. Try another voice.";
      }
    };
    if (name) opts.voiceName = name; else opts.lang = L.tts;
    chrome.tts.stop();
    chrome.tts.speak(L.sample, opts);
  });

  $("swap").addEventListener("click", () => {
    [s.lang1, s.lang2] = [s.lang2, s.lang1];
    $("lang1").value = s.lang1;
    $("lang2").value = s.lang2;
    save();
  });

  $("reset").addEventListener("click", () => {
    s = { ...DS_DEFAULTS };
    fillControls();
    render();
    chrome.storage.sync.set(s);
  });
});
