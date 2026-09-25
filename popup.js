const DEFAULTS = {
  enabled: true, showEn: true, showFr: true,
  frFirst: false, hideNative: true, fontSize: 22,
  wordLookup: true, pauseOnHover: true,
  showExamples: true, showSynonyms: true
};
const boxes = ["enabled", "showEn", "showFr", "frFirst", "hideNative", "wordLookup", "pauseOnHover", "showExamples", "showSynonyms"];
const $ = (id) => document.getElementById(id);

function renderPreview(s) {
  const p = $("preview");
  p.classList.toggle("off", !s.enabled);
  p.classList.toggle("fr-first", s.frFirst);
  $("pEn").hidden = !s.showEn;
  $("pFr").hidden = !s.showFr;
  const previewSize = Math.round(s.fontSize * 0.6) + "px";
  $("pEn").style.fontSize = $("pFr").style.fontSize = previewSize;
  $("sizeVal").textContent = s.fontSize + "px";
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  boxes.forEach((k) => ($(k).checked = s[k]));
  $("fontSize").value = s.fontSize;
  renderPreview(s);

  const save = () => {
    boxes.forEach((k) => (s[k] = $(k).checked));
    s.fontSize = Number($("fontSize").value);
    renderPreview(s);
    chrome.storage.sync.set(s);
  };
  boxes.forEach((k) => $(k).addEventListener("change", save));
  $("fontSize").addEventListener("input", save);
});
