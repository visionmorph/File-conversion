# File Conversion

A browser-based audio, image, and video converter. All processing happens locally in your browser so that your files are never uploaded or sent to a server.

https://visionmorph.github.io/File-conversion/

## Accepted file types

| File type  | Kind                 | Primary path        | Fallback                               |
| ---------- | -------------------- | ------------------- | -------------------------------------- |
| mp3        | Audio                | MediaBunny          | LAME via @mediabunny/mp3-encoder (CDN) |
| ogg        | Audio                | MediaBunny          | —                                      |
| wav        | Audio                | MediaBunny          | —                                      |
| avif       | Image                | Canvas API          | libavif via @jsquash/avif (CDN)        |
| jpg / jpeg | Image                | Canvas API          | —                                      |
| png        | Image                | Canvas API          | —                                      |
| webp       | Image                | Canvas API          | —                                      |
| mkv        | Video                | MediaBunny          | —                                      |
| mov        | Video                | MediaBunny          | —                                      |
| mp4        | Video                | MediaBunny          | —                                      |
| webm       | Video                | MediaBunny          | —                                      |

## Notes

- **Images** are converted with the browser's Canvas API.
- **Audio and video** are converted with [MediaBunny](https://mediabunny.dev), which uses the browser's WebCodecs API when available.
- **Zip downloads** for multiple converted files are created with [fflate](https://github.com/101arrowz/fflate).

## Files

```text
index.html   Markup, drop zone, and conversion queue
style.css    Styling
app.js       Conversion logic, file handling, and UI
```
