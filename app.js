// ---------------------------------------------------------------
// File converter — all conversion happens in this browser tab.
// Images: native Canvas API.
// Video: mediabunny (https://mediabunny.dev), imported from a CDN
//        as an ES module. It leans on the browser's own WebCodecs
//        implementation, so there is no wasm binary to host —
//        that's what keeps this whole repo under GitHub Pages'
//        25MB limit.
// ---------------------------------------------------------------

// If you'd rather pin an exact version, change this to e.g.
// "https://esm.sh/mediabunny@1.10.0". Leaving it unpinned tracks
// the latest release.
const MEDIABUNNY_CDN_URL = "https://esm.sh/mediabunny";

// Used for the "Download all (.zip)" button.
const FFLATE_CDN_URL = "https://esm.sh/fflate";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv"];

const IMAGE_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const VIDEO_MIME = { mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg" };

// Populated lazily on first video conversion so the page loads
// instantly even if the CDN is briefly slow.
let mediabunny = null;
let mediabunnyLoadPromise = null;

function loadMediabunny() {
  if (!mediabunnyLoadPromise) {
    mediabunnyLoadPromise = import(MEDIABUNNY_CDN_URL).then((mod) => {
      mediabunny = mod;
      return mod;
    });
  }
  return mediabunnyLoadPromise;
}

let fflate = null;
let fflateLoadPromise = null;

function loadFflate() {
  if (!fflateLoadPromise) {
    fflateLoadPromise = import(FFLATE_CDN_URL).then((mod) => {
      fflate = mod;
      return mod;
    });
  }
  return fflateLoadPromise;
}

// MP3 encoding isn't natively supported by WebCodecs in most browsers,
// so this WASM (LAME) encoder is loaded only when someone actually
// converts to .mp3 and the browser can't do it natively.
const MP3_ENCODER_CDN_URL = "https://esm.sh/@mediabunny/mp3-encoder";
let mp3Encoder = null;
let mp3EncoderLoadPromise = null;

function loadMp3Encoder() {
  if (!mp3EncoderLoadPromise) {
    mp3EncoderLoadPromise = import(MP3_ENCODER_CDN_URL).then((mod) => {
      mp3Encoder = mod;
      return mod;
    });
  }
  return mp3EncoderLoadPromise;
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

/** @type {Map<string, QueueItem>} */
const items = new Map();
let nextId = 0;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const queueSection = document.getElementById("queue-section");
const queueList = document.getElementById("queue-list");
const removeAllBtn = document.getElementById("remove-all-btn");
const convertFilesBtn = document.getElementById("convert-files-btn");
const convertFilesLabel = convertFilesBtn.querySelector(".btn-label");

// Drives the two 64px layer buttons beneath the queue. Separate from
// each item's own status so "all converted" can flip the group into
// its "Download all" state as a unit.
// idle -> converting -> done (-> idle again once new files are added)
let queuePhase = "idle";
let isZipping = false;

const videoSupported = typeof window.VideoEncoder !== "undefined" && typeof window.VideoDecoder !== "undefined";

// ---------------------------------------------------------------
// Sequential conversion queue — guarantees only one file converts
// at a time, whether triggered by a single row's "Convert" button
// or by "Convert N files". Both funnel through enqueueConvert().
// ---------------------------------------------------------------
let conversionQueue = [];
let isProcessingQueue = false;

function enqueueConvert(id) {
  if (!conversionQueue.includes(id)) conversionQueue.push(id);
  runConversionQueue();
}

async function runConversionQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  queuePhase = "converting";
  render();

  while (conversionQueue.length) {
    const id = conversionQueue.shift();
    await convertItem(id);
  }

  isProcessingQueue = false;
  queuePhase = "done";
  render();
}

// ---------------------------------------------------------------
// File intake
// ---------------------------------------------------------------

function extOf(filename) {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function kindOf(ext) {
  if (IMAGE_EXTS.includes(ext)) return "image";
  if (VIDEO_EXTS.includes(ext)) return "video";
  return null;
}

function addFiles(fileList) {
  for (const file of fileList) {
    const ext = extOf(file.name);
    const kind = kindOf(ext);
    if (!kind) continue; // silently skip unsupported types
    if (kind === "video" && !videoSupported) continue;

    const id = String(nextId++);
    const defaultTarget = kind === "image"
      ? (ext === "jpg" || ext === "jpeg" ? "png" : "jpg")
      : (ext === "mp4" ? "webm" : "mp4");

    items.set(id, {
      id,
      file,
      kind,
      ext,
      status: "pending", // pending | converting | done | error
      progress: 0,
      targetFormat: defaultTarget,
      resultBlob: null,
      resultUrl: null,
      errorMessage: "",
    });
  }
  queuePhase = "idle";
  render();
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  addFiles(fileInput.files);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  })
);
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// ---------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------

// Small inline icon set for the button components (16x16, currentColor).
const ICONS = {
  x: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  download: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12.5V13.5C3 13.7761 3.22386 14 3.5 14H12.5C12.7761 14 13 13.7761 13 13.5V12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  "chevron-down": `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 8L6.5 11.5L13 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function icon(name) {
  const template = document.createElement("template");
  template.innerHTML = ICONS[name].trim();
  return template.content.firstElementChild;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------
// Custom "Output:" format dropdown (replaces the native <select>)
// ---------------------------------------------------------------
// Only one instance is ever open at a time. State + the outside-click
// and Escape handling live here at module scope (registered once)
// rather than per-dropdown, so rebuilding the list on every render()
// can never leave a stray document-level listener behind.
let openDropdown = null; // { wrap, close } | null

function closeOpenDropdown() {
  if (openDropdown) {
    openDropdown.close();
    openDropdown = null;
  }
}

document.addEventListener(
  "click",
  (e) => {
    if (openDropdown && !openDropdown.wrap.contains(e.target)) closeOpenDropdown();
  },
  true
);

document.addEventListener("keydown", (e) => {
  if (openDropdown && e.key === "Escape") {
    e.preventDefault();
    openDropdown.wrap.querySelector(".select-trigger")?.focus();
    closeOpenDropdown();
  }
});

/**
 * Builds an accessible listbox-button dropdown for an item's output
 * format. Mirrors the ARIA "select-only combobox" pattern: a button
 * holds focus and drives everything via aria-activedescendant, so
 * screen readers, arrow keys, and typeahead all behave like a real
 * select, but the popup list is ordinary styleable HTML.
 */
function createFormatDropdown(item, isReadOnly) {
  const wrap = document.createElement("div");
  wrap.className = "select-wrap";

  const uid = `format-${item.id}`;
  const choices = item.kind === "image" ? ["jpg", "png", "webp"] : ["mp4", "webm", "mp3"];
  const sourceNorm = item.ext === "jpeg" ? "jpg" : item.ext;
  const available = choices.filter((c) => c !== sourceNorm);
  let activeIndex = Math.max(0, available.indexOf(item.targetFormat));

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.id = `${uid}-trigger`;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${uid}-list`);
  if (isReadOnly) trigger.setAttribute("aria-disabled", "true");

  const triggerLabel = document.createElement("span");
  triggerLabel.textContent = `.${item.targetFormat}`;
  trigger.appendChild(triggerLabel);
  trigger.appendChild(icon("chevron-down"));
  trigger.lastChild.classList.add("select-chevron");

  const list = document.createElement("ul");
  list.className = "select-list";
  list.id = `${uid}-list`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", trigger.id);
  list.hidden = true;

  const optionEls = available.map((choice, idx) => {
    const li = document.createElement("li");
    li.className = "select-option";
    li.id = `${uid}-opt-${idx}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(choice === item.targetFormat));
    li.dataset.value = choice;

    const label = document.createElement("span");
    label.textContent = `.${choice}`;
    li.appendChild(label);
    li.appendChild(icon("check"));
    li.lastChild.classList.add("option-check");

    li.addEventListener("click", () => {
      selectOption(idx);
      closeOpenDropdown();
      trigger.focus();
    });
    list.appendChild(li);
    return li;
  });

  function selectOption(idx) {
    activeIndex = idx;
    const choice = available[idx];
    item.targetFormat = choice;
    triggerLabel.textContent = `.${choice}`;
    optionEls.forEach((el, i) => el.setAttribute("aria-selected", String(i === idx)));
  }

  function highlightActive() {
    trigger.setAttribute("aria-activedescendant", optionEls[activeIndex]?.id || "");
    optionEls.forEach((el, i) => el.classList.toggle("is-active", i === activeIndex));
  }

  function open() {
    if (isReadOnly || !available.length) return;
    closeOpenDropdown();
    list.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    highlightActive();
    openDropdown = { wrap, close };
  }

  function close() {
    list.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.removeAttribute("aria-activedescendant");
  }

  trigger.addEventListener("click", () => {
    if (isReadOnly) return;
    if (list.hidden) open();
    else closeOpenDropdown();
  });

  trigger.addEventListener("keydown", (e) => {
    if (isReadOnly) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (list.hidden) open();
        else {
          activeIndex = Math.min(activeIndex + 1, available.length - 1);
          highlightActive();
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (list.hidden) open();
        else {
          activeIndex = Math.max(activeIndex - 1, 0);
          highlightActive();
        }
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (list.hidden) open();
        else {
          selectOption(activeIndex);
          closeOpenDropdown();
        }
        break;
      case "Escape":
        if (!list.hidden) {
          e.preventDefault();
          closeOpenDropdown();
        }
        break;
    }
  });

  wrap.appendChild(trigger);
  wrap.appendChild(list);
  return wrap;
}

function render() {
  closeOpenDropdown();
  queueSection.hidden = items.size === 0;
  queueList.innerHTML = "";

  for (const item of items.values()) {
    queueList.appendChild(renderItem(item));
  }

  updateActionBar();
}

function updateActionBar() {
  if (isZipping) return; // preserve the "Zipping..." UI as-is

  const total = items.size;

  // Remove all stays enabled and functional throughout — a person
  // should always be able to clear the queue, even mid-conversion.
  removeAllBtn.disabled = false;

  if (queuePhase === "converting") {
    convertFilesBtn.disabled = true;
    convertFilesBtn.dataset.mode = "converting";
    convertFilesLabel.textContent = "Converting files...";
  } else if (queuePhase === "done") {
    convertFilesBtn.disabled = false;
    convertFilesBtn.dataset.mode = "download";
    convertFilesLabel.textContent = "Download all";
  } else {
    convertFilesBtn.disabled = false;
    convertFilesBtn.dataset.mode = "convert";
    convertFilesLabel.textContent = `Convert ${total} file${total === 1 ? "" : "s"}`;
  }
}

function renderItem(item) {
  const li = document.createElement("li");
  li.className = "queue-item";
  li.dataset.id = item.id;

  // --- info column ---
  const info = document.createElement("div");
  info.className = "item-info";

  const name = document.createElement("p");
  name.className = "item-name";
  name.textContent = item.file.name;
  info.appendChild(name);

  const meta = document.createElement("p");
  meta.className = "item-meta";
  if (item.status === "done") {
    const grew = item.resultBlob.size > item.file.size;
    meta.innerHTML = `${formatBytes(item.file.size)} <span class="arrow-result${grew ? " is-larger" : ""}">→ ${formatBytes(item.resultBlob.size)}</span>`;
  } else if (item.status === "error") {
    meta.innerHTML = `${formatBytes(item.file.size)} <span class="error-text">${escapeHtml(item.errorMessage)}</span>`;
  } else {
    meta.textContent = formatBytes(item.file.size);
  }
  info.appendChild(meta);
  li.appendChild(info);

  // --- action (format select, then convert/download, then remove) ---
  const action = document.createElement("div");
  action.className = "item-action";

  const formatWrap = document.createElement("div");
  formatWrap.className = "item-format";

  const label = document.createElement("label");
  label.textContent = "Output:";
  formatWrap.appendChild(label);

  const isReadOnly = item.status === "done" || queuePhase === "converting";
  formatWrap.appendChild(createFormatDropdown(item, isReadOnly));
  action.appendChild(formatWrap);

  if (item.status === "done") {
    const a = document.createElement("a");
    a.className = "btn-icon";
    a.href = item.resultUrl;
    const outName = swapExt(item.file.name, item.targetFormat);
    a.download = outName;
    a.dataset.tooltip = "Download";
    a.setAttribute("aria-label", "Download");
    a.appendChild(icon("download"));
    action.appendChild(a);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn-icon";
  remove.dataset.tooltip = "Remove";
  remove.setAttribute("aria-label", "Remove from queue");
  remove.appendChild(icon("x"));
  remove.addEventListener("click", () => {
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    items.delete(item.id);
    render();
  });
  action.appendChild(remove);

  li.appendChild(action);

  // --- progress (flush against the bottom edge; only shown mid-convert) ---
  const progressWrap = document.createElement("div");
  progressWrap.className = "item-progress";
  progressWrap.hidden = item.status !== "converting";
  const bar = document.createElement("div");
  bar.className = "item-progress-bar";
  bar.style.width = `${Math.round(item.progress * 100)}%`;
  progressWrap.appendChild(bar);
  li.appendChild(progressWrap);

  return li;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function swapExt(filename, newExt) {
  const dot = filename.lastIndexOf(".");
  const base = dot > -1 ? filename.slice(0, dot) : filename;
  return `${base}.${newExt}`;
}

// ---------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------

async function convertItem(id) {
  const item = items.get(id);
  if (!item) return;

  item.status = "converting";
  item.progress = 0;
  item.errorMessage = "";
  render();

  try {
    const blob = item.kind === "image"
      ? await convertImage(item, (p) => updateProgress(id, p))
      : await convertVideo(item, (p) => updateProgress(id, p));

    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    item.resultBlob = blob;
    item.resultUrl = URL.createObjectURL(blob);
    item.status = "done";
    item.progress = 1;
  } catch (err) {
    console.error(err);
    item.status = "error";
    item.errorMessage = err?.message || "Conversion failed";
  }
  render();
}

function updateProgress(id, p) {
  const item = items.get(id);
  if (!item) return;
  item.progress = p;
  const bar = queueList.querySelector(`[data-id="${id}"] .item-progress-bar`);
  if (bar) bar.style.width = `${Math.round(p * 100)}%`;
}

// --- images ---------------------------------------------------

async function convertImage(item, onProgress) {
  onProgress(0.1);
  const bitmap = await createImageBitmap(item.file, { imageOrientation: "from-image" });
  onProgress(0.4);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");

  // JPEG has no alpha channel — flatten onto white so transparency
  // doesn't turn black.
  if (item.targetFormat === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  onProgress(0.7);

  const mime = IMAGE_MIME[item.targetFormat];
  const quality = item.targetFormat === "png" ? undefined : 0.92;

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode image"))),
      mime,
      quality
    );
  });
  onProgress(1);
  return blob;
}

// --- video ------------------------------------------------------

async function convertVideo(item, onProgress) {
  onProgress(0.02);
  const mb = mediabunny || (await loadMediabunny());
  const {
    Input,
    Output,
    Conversion,
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
    Mp3OutputFormat,
    canEncodeAudio,
  } = mb;

  const input = new Input({
    source: new BlobSource(item.file),
    formats: ALL_FORMATS,
  });

  const isAudioOnly = item.targetFormat === "mp3";

  let outputFormat;
  if (item.targetFormat === "mp4") outputFormat = new Mp4OutputFormat();
  else if (item.targetFormat === "webm") outputFormat = new WebMOutputFormat();
  else outputFormat = new Mp3OutputFormat();

  const output = new Output({
    format: outputFormat,
    target: new BufferTarget(),
  });

  const conversionOptions = { input, output };

  if (isAudioOnly) {
    // .mp3 is audio-only — drop the video track entirely.
    conversionOptions.video = { discard: true };

    // Most browsers can't encode MP3 natively via WebCodecs. Only pull
    // in the ~130kB WASM (LAME) encoder if native support is missing.
    if (!(await canEncodeAudio("mp3"))) {
      const { registerMp3Encoder } = mp3Encoder || (await loadMp3Encoder());
      registerMp3Encoder();
    }
  }

  const conversion = await Conversion.init(conversionOptions);

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks?.map((t) => t.reason).join(", ");
    throw new Error(reasons ? `Unsupported: ${reasons}` : "This file can't be converted to that format");
  }

  conversion.onProgress = (p) => onProgress(Math.min(0.98, p));

  await conversion.execute();
  onProgress(1);

  return new Blob([output.target.buffer], { type: VIDEO_MIME[item.targetFormat] });
}

// ---------------------------------------------------------------
// Action bar (the two 64px layer buttons)
// ---------------------------------------------------------------

removeAllBtn.addEventListener("click", () => {
  if (removeAllBtn.disabled) return;
  for (const item of items.values()) {
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
  }
  items.clear();
  queuePhase = "idle";
  render();
});

convertFilesBtn.addEventListener("click", () => {
  if (convertFilesBtn.disabled) return;

  if (convertFilesBtn.dataset.mode === "download") {
    downloadAllAsZip();
    return;
  }

  const pending = [...items.values()].filter((i) => i.status === "pending" || i.status === "error");
  for (const item of pending) enqueueConvert(item.id);
});

async function downloadAllAsZip() {
  const done = [...items.values()].filter((i) => i.status === "done");
  if (done.length === 0) return;

  const originalLabel = convertFilesLabel.textContent;
  isZipping = true;
  convertFilesBtn.disabled = true;
  removeAllBtn.disabled = true;
  convertFilesLabel.textContent = "Zipping...";

  try {
    const { zip } = fflate || (await loadFflate());

    // Build { filename: Uint8Array }, disambiguating any output
    // filenames that would otherwise collide.
    const files = {};
    const usedNames = new Set();
    for (const item of done) {
      let name = swapExt(item.file.name, item.targetFormat);
      if (usedNames.has(name)) {
        const dot = name.lastIndexOf(".");
        const base = dot > -1 ? name.slice(0, dot) : name;
        const ext = dot > -1 ? name.slice(dot) : "";
        let n = 2;
        while (usedNames.has(`${base} (${n})${ext}`)) n++;
        name = `${base} (${n})${ext}`;
      }
      usedNames.add(name);
      files[name] = new Uint8Array(await item.resultBlob.arrayBuffer());
    }

    // zip() is async and can use worker threads internally, so it
    // won't freeze the tab the way zipSync() would on larger batches.
    const zipped = await new Promise((resolve, reject) => {
      zip(files, (err, data) => (err ? reject(err) : resolve(data)));
    });

    const blob = new Blob([zipped], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "converted-files.zip";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    alert("Couldn't build the zip: " + (err?.message || "unknown error"));
  } finally {
    isZipping = false;
    convertFilesBtn.disabled = false;
    removeAllBtn.disabled = false;
    convertFilesLabel.textContent = originalLabel;
    updateActionBar();
  }
}
