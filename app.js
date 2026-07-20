// ---------------------------------------------------------------
// Local Convert — all conversion happens in this browser tab.
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

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];
const VIDEO_EXTS = ["mp4", "webm"];

const IMAGE_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const VIDEO_MIME = { mp4: "video/mp4", webm: "video/webm" };

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
const supportNote = document.getElementById("support-note");

// Drives the two 64px layer buttons beneath the queue. Separate from
// each item's own status so "all converted" can flip the group into
// its "Download all" state as a unit.
// idle -> converting -> done (-> idle again once new files are added)
let queuePhase = "idle";

const videoSupported = typeof window.VideoEncoder !== "undefined" && typeof window.VideoDecoder !== "undefined";
if (!videoSupported) supportNote.hidden = false;

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

function render() {
  queueSection.hidden = items.size === 0;
  queueList.innerHTML = "";

  for (const item of items.values()) {
    queueList.appendChild(renderItem(item));
  }

  updateActionBar();
}

function updateActionBar() {
  const total = items.size;

  if (queuePhase === "converting") {
    removeAllBtn.disabled = true;
    convertFilesBtn.disabled = true;
    convertFilesBtn.dataset.mode = "converting";
    convertFilesLabel.textContent = "Converting files...";
  } else if (queuePhase === "done") {
    removeAllBtn.disabled = false;
    convertFilesBtn.disabled = false;
    convertFilesBtn.dataset.mode = "download";
    convertFilesLabel.textContent = "Download all";
  } else {
    removeAllBtn.disabled = false;
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
    meta.innerHTML = `${formatBytes(item.file.size)} <span class="arrow-result">→ ${formatBytes(item.resultBlob.size)}</span>`;
  } else if (item.status === "error") {
    meta.innerHTML = `${formatBytes(item.file.size)} <span class="error-text">${escapeHtml(item.errorMessage)}</span>`;
  } else {
    meta.textContent = `${formatBytes(item.file.size)} · .${item.ext}`;
  }
  info.appendChild(meta);
  li.appendChild(info);

  // --- format select ---
  const formatWrap = document.createElement("div");
  formatWrap.className = "item-format";
  const select = document.createElement("select");
  select.disabled = item.status === "converting";
  const choices = item.kind === "image" ? ["jpg", "png", "webp"] : ["mp4", "webm"];
  const sourceNorm = item.ext === "jpeg" ? "jpg" : item.ext;
  for (const choice of choices) {
    if (choice === sourceNorm) continue;
    const opt = document.createElement("option");
    opt.value = choice;
    opt.textContent = `→ .${choice}`;
    opt.selected = choice === item.targetFormat;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => {
    item.targetFormat = select.value;
  });
  formatWrap.appendChild(select);
  li.appendChild(formatWrap);

  // --- progress ---
  const progressWrap = document.createElement("div");
  progressWrap.className = "item-progress";
  const bar = document.createElement("div");
  bar.className = "item-progress-bar";
  bar.style.width = `${Math.round(item.progress * 100)}%`;
  progressWrap.appendChild(bar);
  li.appendChild(progressWrap);

  // --- action ---
  const action = document.createElement("div");
  action.className = "item-action";

  if (item.status === "done") {
    const a = document.createElement("a");
    a.className = "btn-ghost-text";
    a.href = item.resultUrl;
    const outName = swapExt(item.file.name, item.targetFormat);
    a.download = outName;
    a.appendChild(document.createTextNode("Download"));
    a.appendChild(icon("download"));
    action.appendChild(a);
  } else {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-ghost-text";
    btn.textContent = item.status === "converting" ? "Converting…" : item.status === "error" ? "Retry" : "Convert";
    btn.disabled = item.status === "converting";
    btn.addEventListener("click", () => convertItem(item.id));
    action.appendChild(btn);
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
  } = mb;

  const input = new Input({
    source: new BlobSource(item.file),
    formats: ALL_FORMATS,
  });

  const outputFormat = item.targetFormat === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat();
  const output = new Output({
    format: outputFormat,
    target: new BufferTarget(),
  });

  const conversion = await Conversion.init({ input, output });

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

convertFilesBtn.addEventListener("click", async () => {
  if (convertFilesBtn.disabled) return;

  if (convertFilesBtn.dataset.mode === "download") {
    downloadAllAsZip();
    return;
  }

  queuePhase = "converting";
  render();

  const pending = [...items.values()].filter((i) => i.status === "pending" || i.status === "error");
  for (const item of pending) {
    await convertItem(item.id);
  }

  queuePhase = "done";
  render();
});

function downloadAllAsZip() {
  // Intentionally not wired up yet — zip functionality is on hold.
  // When ready: lazy-load fflate the same way mediabunny is loaded
  // above, build { filename: Uint8Array } from each item's
  // resultBlob, and zip with fflate's async zip() (not zipSync())
  // so large batches don't freeze the tab.
  console.log("Download all as .zip — not implemented yet.");
}
