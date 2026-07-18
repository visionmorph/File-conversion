# Local Convert

A tiny, dependency-free image and video converter that runs entirely in the
browser. Nothing is uploaded — files never leave the tab.

- **Images** (jpg ↔ png ↔ webp): converted with the native Canvas API.
- **Video** (mp4 ↔ webm): converted with [mediabunny](https://mediabunny.dev),
  which wraps the browser's own WebCodecs API for hardware-accelerated
  encode/decode. It's loaded from a CDN as an ES module at runtime, so **no
  wasm binary lives in this repo** — that's what keeps the whole thing well
  under GitHub Pages' 25MB limit.

## Files

```
index.html   markup + drop zone + queue
style.css    all styling
app.js       all logic (file intake, image + video conversion, UI)
```

No build step. No `node_modules`. No bundler.

## Running locally

Because `app.js` is loaded as an ES module (`<script type="module">`), you
can't just double-click `index.html` — browsers block module imports over
the `file://` protocol. Serve the folder instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

or with Node:

```bash
npx serve .
```

## Deploying to GitHub Pages

1. Push these three files to a repo (root, or a `/docs` folder — your call).
2. In the repo settings, enable **Pages** and point it at that
   branch/folder.
3. Done. There's nothing to build.

## Browser support

Image conversion works everywhere `createImageBitmap` and `<canvas>` exist
(all current browsers).

Video conversion needs [WebCodecs](https://caniuse.com/webcodecs) — current
Chrome, Edge, and Safari (16.4+) support it. Firefox's support has been
partial; the app detects this at load and hides video conversion with an
explanatory note if `VideoEncoder`/`VideoDecoder` aren't available, rather
than failing silently.

## Notes on the mediabunny CDN import

`app.js` imports mediabunny like this:

```js
const MEDIABUNNY_CDN_URL = "https://esm.sh/mediabunny";
```

This tracks the latest published release. If you'd rather pin a specific
version (recommended once you're happy with how it behaves, so an upstream
release can't change behavior under you), change it to something like:

```js
const MEDIABUNNY_CDN_URL = "https://esm.sh/mediabunny@1.10.0";
```

`jsdelivr` is a fine alternative if `esm.sh` is ever slow or down:

```js
const MEDIABUNNY_CDN_URL = "https://cdn.jsdelivr.net/npm/mediabunny/+esm";
```

The import is lazy — it only happens the first time someone actually
converts a video, so the page itself loads instantly and image conversion
never waits on it.

## Extending

- **Batch download as .zip**: not included, to avoid pulling in a zip
  library. If you want it, [`fflate`](https://github.com/101arch/fflate) is
  small and would slot in cleanly next to the existing "Convert all" button.
- **Resize/bitrate controls for video**: mediabunny's `Conversion.init`
  accepts `video: { width, height, bitrate }` and `audio: { ... }` options —
  see the [conversion guide](https://mediabunny.dev/guide/converting-media-files).
  Wiring a resolution dropdown into `convertVideo()` in `app.js` is
  straightforward from there.
- **Quality slider for images**: `canvas.toBlob` already takes a quality
  argument (currently hardcoded to `0.92` for jpg/webp) — expose it as a
  range input per row if you want finer control.
