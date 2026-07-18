const fileInput = document.querySelector("#file-input");
const dropZone = document.querySelector("#drop-zone");
const fileStatus = document.querySelector("#file-status");
const formatSelect = document.querySelector("#format-select");
const convertButton = document.querySelector("#convert-button");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const videoInput = document.querySelector("#video-input");
const videoStatus = document.querySelector("#video-status");
const videoConvertButton = document.querySelector("#video-convert-button");
const videoResult = document.querySelector("#video-result");
const videoProgress = document.querySelector("#video-progress");
const videoProgressIndicator = document.querySelector("#video-progress-indicator");
const videoProgressDetails = document.querySelector("#video-progress-details");

let selectedFile;
let previewUrl;
let selectedVideo;
let videoFfmpeg;

// Asking a tiny canvas to encode WebP is more reliable than guessing from a browser name.
function supportsWebpOutput() {
  try {
    const canvas = document.createElement("canvas");
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

const webpOutputSupported = supportsWebpOutput();
const webpOption = formatSelect.querySelector('option[value="webp"]');
if (!webpOutputSupported) webpOption.remove();

function extensionOf(file) {
  return file.name.split(".").pop().toLowerCase();
}

function selectFile(file) {
  if (!file || !["png", "jpg", "jpeg", "webp"].includes(extensionOf(file))) {
    selectedFile = undefined;
    fileStatus.textContent = "Please choose a PNG, JPG, or WebP image.";
    preview.hidden = true;
    formatSelect.disabled = true;
    convertButton.disabled = true;
    return;
  }

  selectedFile = file;
  const source = extensionOf(file);
  const sourceFormat = source === "jpeg" ? "jpg" : source;
  [...formatSelect.options].forEach((option) => {
    const isSourceFormat = option.value === sourceFormat;
    option.disabled = isSourceFormat;
    option.hidden = isSourceFormat;
  });
  formatSelect.value = source === "webp" ? "png" : webpOutputSupported ? "webp" : source === "png" ? "jpg" : "png";
  formatSelect.disabled = false;
  convertButton.disabled = false;
  fileStatus.textContent = `${file.name} selected (${Math.ceil(file.size / 1024)} KB)`;
  result.textContent = "";
  result.classList.remove("is-error");
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  preview.hidden = false;
}

fileInput.addEventListener("change", () => selectFile(fileInput.files[0]));

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});
dropZone.addEventListener("drop", (event) => selectFile(event.dataTransfer.files[0]));

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("This image could not be read.")); };
    image.src = url;
  });
}

function canvasToBlob(canvas, mimeType) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Your browser could not create the converted image.")), mimeType, 0.92);
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

convertButton.addEventListener("click", async () => {
  if (!selectedFile) return;
  try {
    convertButton.disabled = true;
    result.textContent = "Converting locally…";
    const image = await loadImage(selectedFile);
    const target = formatSelect.value;
    const source = extensionOf(selectedFile);
    if ((source === "jpg" && target === "jpg") || (source === "jpeg" && target === "jpg") || source === target) {
      throw new Error("Choose a different output format.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (target === "jpg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0);
    const mimeType = target === "jpg" ? "image/jpeg" : target === "webp" ? "image/webp" : "image/png";
    const blob = await canvasToBlob(canvas, mimeType);
    const baseName = selectedFile.name.replace(/\.[^.]+$/, "");
    download(blob, `${baseName}.${target}`);
    result.textContent = "Converted successfully. Your download should begin now.";
    result.classList.remove("is-error");
  } catch (error) {
    result.textContent = error.message || "The image could not be converted.";
    result.classList.add("is-error");
  } finally {
    convertButton.disabled = false;
  }
});

function selectVideo(file) {
  if (!file || extensionOf(file) !== "mp4") {
    selectedVideo = undefined;
    videoStatus.textContent = "Please choose an .mp4 video.";
    videoConvertButton.disabled = true;
    return;
  }
  selectedVideo = file;
  videoStatus.textContent = `${file.name} selected (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
  videoResult.textContent = "";
  videoResult.classList.remove("is-error");
  videoProgress.hidden = true;
  videoConvertButton.disabled = false;
}

videoInput.addEventListener("change", () => selectVideo(videoInput.files[0]));

function megabytes(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function setVideoProgress(state, loadedBytes = 0, totalBytes = selectedVideo?.size ?? 0) {
  const progress = totalBytes ? Math.min(100, (loadedBytes / totalBytes) * 100) : 0;
  videoProgress.hidden = false;
  videoProgress.classList.toggle("is-indeterminate", state === "indeterminate");
  videoProgressIndicator.style.width = `${progress}%`;
  videoProgressDetails.textContent = `${megabytes(loadedBytes)} MB of ${megabytes(totalBytes)} MB`;
  if (state === "determinate") {
    videoProgress.setAttribute("aria-valuenow", String(Math.round(progress)));
    videoProgress.setAttribute("aria-valuetext", `${megabytes(loadedBytes)} MB of ${megabytes(totalBytes)} MB`);
  } else {
    videoProgress.removeAttribute("aria-valuenow");
    videoProgress.setAttribute("aria-valuetext", "Preparing the local video engine");
  }
}

async function readVideoWithProgress(file) {
  if (!file.stream) {
    const data = new Uint8Array(await file.arrayBuffer());
    setVideoProgress("determinate", file.size, file.size);
    return data;
  }
  const data = new Uint8Array(file.size);
  const reader = file.stream().getReader();
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    data.set(value, offset);
    offset += value.length;
    setVideoProgress("determinate", offset, file.size);
  }
  return data;
}

async function withTimeout(task, timeoutMs, failureMessage) {
  let timeoutId;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(failureMessage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function createLocalClassWorkerURL() {
  const workerBaseUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm";
  const [workerSource, constantsSource, errorsSource] = await withTimeout(Promise.all([
    fetch(`${workerBaseUrl}/worker.js`).then((response) => {
      if (!response.ok) throw new Error(`Worker download failed (${response.status}).`);
      return response.text();
    }),
    fetch(`${workerBaseUrl}/const.js`).then((response) => {
      if (!response.ok) throw new Error(`Worker constants download failed (${response.status}).`);
      return response.text();
    }),
    fetch(`${workerBaseUrl}/errors.js`).then((response) => {
      if (!response.ok) throw new Error(`Worker error-handler download failed (${response.status}).`);
      return response.text();
    }),
  ]), 30_000, "The FFmpeg worker files could not be downloaded within 30 seconds. Check your network or content-blocking settings.");

  const constantsURL = URL.createObjectURL(new Blob([constantsSource], { type: "text/javascript" }));
  const errorsURL = URL.createObjectURL(new Blob([errorsSource], { type: "text/javascript" }));
  const localWorkerSource = workerSource
    .replace('from "./const.js";', `from "${constantsURL}";`)
    .replace('from "./errors.js";', `from "${errorsURL}";`);
  return URL.createObjectURL(new Blob([localWorkerSource], { type: "text/javascript" }));
}

async function getVideoConverter() {
  if (videoFfmpeg) return videoFfmpeg;
  if (!navigator.onLine) {
    throw new Error("You appear to be offline. Connect to the internet so the local video engine can download once, then try again.");
  }
  videoResult.textContent = "Preparing the local video engine. This can take a moment the first time.";
  const [{ FFmpeg }, { toBlobURL }] = await withTimeout(Promise.all([
    import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js"),
    import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js"),
  ]), 30_000, "The FFmpeg library could not be downloaded within 30 seconds. Check your internet connection or whether jsDelivr is blocked.");
  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => {
    if (!selectedVideo || !Number.isFinite(progress)) return;
    const processedBytes = selectedVideo.size * Math.max(0, Math.min(1, progress));
    setVideoProgress("determinate", processedBytes, selectedVideo.size);
  });
  const baseUrl = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  videoResult.textContent = "Preparing the local video worker…";
  const classWorkerURL = await createLocalClassWorkerURL();
  videoResult.textContent = "Downloading the local video engine…";
  const coreURL = await withTimeout(
    toBlobURL(`${baseUrl}/ffmpeg-core.js`, "text/javascript"),
    45_000,
    "The FFmpeg engine script could not be downloaded within 45 seconds. Check your network or content-blocking settings."
  );
  const wasmURL = await withTimeout(
    toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, "application/wasm"),
    90_000,
    "The FFmpeg engine file could not be downloaded within 90 seconds. Check your network or content-blocking settings."
  );
  videoResult.textContent = "Starting the local video engine…";
  await withTimeout(ffmpeg.load({
    classWorkerURL,
    coreURL,
    wasmURL,
  }), 45_000, "The FFmpeg worker could not start within 45 seconds. Try opening the app in a current Chrome, Edge, or Firefox browser.");
  videoFfmpeg = { ffmpeg };
  return videoFfmpeg;
}

videoConvertButton.addEventListener("click", async () => {
  if (!selectedVideo) return;
  try {
    videoConvertButton.disabled = true;
    setVideoProgress("indeterminate", 0, selectedVideo.size);
    const { ffmpeg } = await getVideoConverter();
    const inputName = "input.mp4";
    const outputName = "output.webm";
    videoResult.textContent = "Reading your video locally…";
    setVideoProgress("determinate", 0, selectedVideo.size);
    await ffmpeg.writeFile(inputName, await readVideoWithProgress(selectedVideo));
    videoResult.textContent = "Converting locally… keep this tab open.";
    await ffmpeg.exec(["-i", inputName, "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-c:a", "libopus", outputName]);
    const data = await ffmpeg.readFile(outputName);
    const baseName = selectedVideo.name.replace(/\.[^.]+$/, "");
    download(new Blob([data.buffer], { type: "video/webm" }), `${baseName}.webm`);
    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);
    videoResult.textContent = "Converted successfully. Your WebM download should begin now.";
    setVideoProgress("determinate", selectedVideo.size, selectedVideo.size);
    videoResult.classList.remove("is-error");
  } catch (error) {
    videoResult.textContent = error.message || "The video could not be converted.";
    videoResult.classList.add("is-error");
    videoProgress.hidden = true;
  } finally {
    videoConvertButton.disabled = false;
  }
});
