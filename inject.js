// Runs inside the YouTube page itself. It watches for the player's own
// caption request and passes that URL to content.js. YouTube's caption URLs
// carry a signed token, so reusing the player's URL is far more reliable
// than building one from scratch.
(() => {
  const report = (input) => {
    try {
      const raw = input instanceof Request ? input.url : String(input);
      const url = new URL(raw, location.href);
      if (url.pathname.includes("/api/timedtext")) {
        window.postMessage({ source: "dualsubs", type: "timedtext", url: url.href }, "*");
      }
    } catch (_) { /* ignore unparseable URLs */ }
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    report(url);
    return origOpen.call(this, method, url, ...rest);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    report(input);
    return origFetch.apply(this, arguments);
  };
})();
