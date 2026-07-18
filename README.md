# Local File Converter

A browser-only image converter plus MP4-to-WebM video converter. It has no backend and sends no selected file anywhere.

## Run it

Publish this static site to an HTTPS host such as GitHub Pages, then open its public website address in a modern browser. MP4-to-WebM conversion requires a hosted browser context so its Web Worker can start safely.

## How it works

1. The browser receives the file through the file picker or drag-and-drop.
2. The browser decodes the selected image into the current browser tab's memory.
3. JavaScript draws it onto a temporary canvas and exports it as PNG, JPG, or WebP.
4. A `Blob` becomes a temporary local URL, which the browser downloads. No network request is made by the app.

Video conversion loads FFmpeg WebAssembly from a public package CDN when the user first converts a video. That downloads the converter program, not the user's video. For production, host the FFmpeg assets with the app instead of relying on a public CDN.

The video UI uses an indeterminate progress bar while the engine starts (the browser cannot know an accurate completion percentage), then a determinate bar while it reads and transcodes the selected file. The label below the bar shows processed MB out of the original file size.

## Current scope

- PNG → JPG (transparent areas become white)
- JPG → PNG
- PNG/JPG/WebP → another supported image format
- MP4 → WebM (VP9 video and Opus audio)

WebP export is offered only when the current browser confirms it can encode WebP.

The next sensible additions are image sizing, compression controls, more formats, and automated tests for edge cases.
