# Dual Subtitles EN/FR for YouTube

A Chrome extension that shows English and French subtitles at the same time on YouTube,
with a hover tooltip giving definitions, example sentences and synonyms from Wiktionary.

![English and French subtitle lines with a definition tooltip for the French word "aprèm"](store/screenshot-1.png)

## What it does

- Draws both language lines over the player, using the caption track the YouTube player
  itself requested — including auto-translated tracks.
- Hovering a word shows its part of speech, definitions, an example sentence and synonyms.
  Inflected forms are resolved to their base word (*allons* → *aller*), and French elisions
  (*l'*, *qu'*, *d'*) are stripped before lookup.
- Optionally pauses the video while you read the tooltip.
- Everything is toggleable from the popup: which lines show, which sits on top, text size,
  hiding YouTube's own captions, word lookup, examples and synonyms.

## Install from source

1. `git clone https://github.com/jasrajsinghbedi/dual-subs.git`
2. Open `chrome://extensions`, turn on **Developer mode**.
3. **Load unpacked** → pick the cloned folder.
4. Open any YouTube video that has captions.

## How it works

| File | Role |
| --- | --- |
| `inject.js` | Runs in the page's own world and watches `fetch`/`XMLHttpRequest` for the player's `/api/timedtext` call. YouTube's caption URLs carry a signed token, so reusing the player's URL is far more reliable than building one. |
| `content.js` | Fetches the EN and FR versions of that track, draws the overlay, and renders the lookup tooltip. |
| `background.js` | Queries Wiktionary (and Datamuse for extra English synonyms) from the service worker, because YouTube's CSP blocks those requests from the page. |
| `popup.html` / `popup.js` | Settings, stored in `chrome.storage.sync`. |
| `overlay.css` | Overlay and tooltip styling. |

## Privacy

No servers, no accounts, no analytics. The only thing that leaves your machine is the single
word you hover, sent to Wiktionary (and Datamuse for English synonyms) to look it up.
Full policy: https://jasrajsinghbedi.github.io/dual-subs-privacy/

## Credits

Definitions, examples and synonyms come from [Wiktionary](https://en.wiktionary.org/),
licensed under CC BY-SA. Extra English synonyms come from [Datamuse](https://www.datamuse.com/api/).
