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


// IMAGE CONVERTER

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

if (!webpOutputSupported && webpOption) {
  webpOption.remove();
}


function extensionOf(file) {
  return file.name.split(".").pop().toLowerCase();
}


function selectFile(file) {

  if (!file || !["png","jpg","jpeg","webp"].includes(extensionOf(file))) {

    selectedFile = undefined;
    fileStatus.textContent =
      "Please choose a PNG, JPG, or WebP image.";

    preview.hidden = true;
    formatSelect.disabled = true;
    convertButton.disabled = true;

    return;
  }


  selectedFile = file;

  const source = extensionOf(file);
  const sourceFormat =
    source === "jpeg" ? "jpg" : source;


  [...formatSelect.options].forEach(option => {

    const isSourceFormat =
      option.value === sourceFormat;

    option.disabled = isSourceFormat;
    option.hidden = isSourceFormat;

  });


  formatSelect.value =
    source === "webp"
      ? "png"
      : webpOutputSupported
        ? "webp"
        : source === "png"
          ? "jpg"
          : "png";


  formatSelect.disabled = false;
  convertButton.disabled = false;


  fileStatus.textContent =
    `${file.name} selected (${Math.ceil(file.size / 1024)} KB)`;


  result.textContent = "";
  result.classList.remove("is-error");


  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }


  previewUrl =
    URL.createObjectURL(file);

  preview.src = previewUrl;
  preview.hidden = false;
}


fileInput.addEventListener(
  "change",
  () => selectFile(fileInput.files[0])
);


["dragenter","dragover"].forEach(eventName => {

  dropZone.addEventListener(eventName,event=>{

    event.preventDefault();
    dropZone.classList.add("is-dragging");

  });

});


["dragleave","drop"].forEach(eventName=>{

  dropZone.addEventListener(eventName,event=>{

    event.preventDefault();
    dropZone.classList.remove("is-dragging");

  });

});


dropZone.addEventListener(
  "drop",
  event => selectFile(event.dataTransfer.files[0])
);



function loadImage(file){

  return new Promise((resolve,reject)=>{

    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = ()=>{

      URL.revokeObjectURL(url);
      resolve(image);

    };

    image.onerror = ()=>{

      URL.revokeObjectURL(url);
      reject(
        new Error("This image could not be read.")
      );

    };

    image.src=url;

  });

}


function canvasToBlob(canvas,mimeType){

  return new Promise((resolve,reject)=>{

    canvas.toBlob(blob=>{

      blob
        ? resolve(blob)
        : reject(
            new Error(
              "Your browser could not create the converted image."
            )
          );

    },mimeType,0.92);

  });

}


function download(blob,filename){

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href=url;
  link.download=filename;

  link.click();

  setTimeout(
    ()=>URL.revokeObjectURL(url),
    1000
  );

}

// IMAGE CONVERSION BUTTON

convertButton.addEventListener("click", async () => {

  if (!selectedFile) return;


  try {

    convertButton.disabled = true;

    result.textContent =
      "Converting locally…";


    const image =
      await loadImage(selectedFile);


    const target =
      formatSelect.value;


    const source =
      extensionOf(selectedFile);


    if (
      source === target ||
      (source === "jpeg" && target === "jpg") ||
      (source === "jpg" && target === "jpg")
    ) {
      throw new Error(
        "Choose a different output format."
      );
    }


    const canvas =
      document.createElement("canvas");


    canvas.width =
      image.naturalWidth;

    canvas.height =
      image.naturalHeight;


    const context =
      canvas.getContext("2d");


    if (target === "jpg") {

      context.fillStyle = "#ffffff";

      context.fillRect(
        0,
        0,
        canvas.width,
        canvas.height
      );

    }


    context.drawImage(image,0,0);


    const mimeType =
      target === "jpg"
        ? "image/jpeg"
        : target === "webp"
          ? "image/webp"
          : "image/png";


    const blob =
      await canvasToBlob(
        canvas,
        mimeType
      );


    const baseName =
      selectedFile.name.replace(
        /\.[^.]+$/,
        ""
      );


    download(
      blob,
      `${baseName}.${target}`
    );


    result.textContent =
      "Converted successfully. Your download should begin now.";

    result.classList.remove("is-error");


  } catch(error){

    result.textContent =
      error.message ||
      "The image could not be converted.";

    result.classList.add("is-error");


  } finally {

    convertButton.disabled=false;

  }

});




// VIDEO CONVERTER


function selectVideo(file){

  if (!file || extensionOf(file)!=="mp4"){

    selectedVideo = undefined;

    videoStatus.textContent =
      "Please choose an .mp4 video.";

    videoConvertButton.disabled=true;

    return;
  }


  selectedVideo=file;


  videoStatus.textContent =
    `${file.name} selected (${(file.size / 1024 / 1024).toFixed(1)} MB)`;


  videoResult.textContent="";

  videoResult.classList.remove("is-error");


  videoProgress.hidden=true;


  videoConvertButton.disabled=false;

}



videoInput.addEventListener(
  "change",
  ()=>selectVideo(videoInput.files[0])
);



function setVideoProgress(percent,text){

  videoProgress.hidden=false;

  videoProgress.classList.remove(
    "is-indeterminate"
  );


  videoProgressIndicator.style.width =
    `${percent}%`;


  videoProgressDetails.textContent =
    text;


  videoProgress.setAttribute(
    "aria-valuenow",
    Math.round(percent)
  );

}




async function getVideoConverter(){


  if(videoFfmpeg){

    return videoFfmpeg;

  }



  if(!navigator.onLine){

    throw new Error(
      "You are offline. Connect to the internet once so FFmpeg can load."
    );

  }



  videoResult.textContent =
    "Loading FFmpeg engine...";



  const [
    {FFmpeg},
    {toBlobURL}
  ] = await Promise.all([


    import(
      "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js"
    ),


    import(
      "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js"
    )

  ]);



  const ffmpeg =
    new FFmpeg();



  ffmpeg.on(
    "progress",
    ({progress})=>{

      if(!Number.isFinite(progress))
        return;


      const percent =
        Math.min(
          100,
          progress * 100
        );


      setVideoProgress(
        percent,
        `Converting ${percent.toFixed(0)}%`
      );

    }
  );



  const baseURL =
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";



  await ffmpeg.load({

    coreURL:
      await toBlobURL(
        `${baseURL}/ffmpeg-core.js`,
        "text/javascript"
      ),


    wasmURL:
      await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        "application/wasm"
      )

  });



  videoFfmpeg =
    ffmpeg;



  return ffmpeg;

}




videoConvertButton.addEventListener(
  "click",
  async ()=>{


    if(!selectedVideo)
      return;



    try{


      videoConvertButton.disabled=true;



      videoProgress.hidden=false;

      videoProgress.classList.add(
        "is-indeterminate"
      );



      const ffmpeg =
        await getVideoConverter();



      const inputName =
        "input.mp4";


      const outputName =
        "output.webm";



      videoResult.textContent =
        "Reading video...";



      const data =
        new Uint8Array(
          await selectedVideo.arrayBuffer()
        );



      await ffmpeg.writeFile(
        inputName,
        data
      );



      videoResult.textContent =
        "Converting locally... keep this tab open.";



      await ffmpeg.exec([

        "-i",
        inputName,

        "-c:v",
        "libvpx-vp9",

        "-crf",
        "32",

        "-b:v",
        "0",

        "-c:a",
        "libopus",

        outputName

      ]);



      const output =
        await ffmpeg.readFile(
          outputName
        );



      const baseName =
        selectedVideo.name.replace(
          /\.[^.]+$/,
          ""
        );



      download(

        new Blob(
          [
            output.buffer
          ],
          {
            type:"video/webm"
          }
        ),

        `${baseName}.webm`

      );



      await ffmpeg.deleteFile(
        inputName
      );


      await ffmpeg.deleteFile(
        outputName
      );



      videoResult.textContent =
        "Converted successfully. Your WebM download should begin now.";


      setVideoProgress(
        100,
        "Complete"
      );


      videoResult.classList.remove(
        "is-error"
      );



    }catch(error){


      console.error(error);


      videoResult.textContent =
        error.message ||
        "The video could not be converted.";


      videoResult.classList.add(
        "is-error"
      );


      videoProgress.hidden=true;



    }finally{


      videoConvertButton.disabled=false;


    }


  }
);
