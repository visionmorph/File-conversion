# File conversion

An image and video converter that runs entirely in the browser.
Your data isn't uploaded to a server, your files never leave the browser.

- **Images** (jpg ↔ png ↔ webp) are converted with the Canvas API from your browser.
- **Video** (mp4 ↔ webm) is converted with [mediabunny](https://mediabunny.dev),
  which wraps the browser's own WebCodecs API for hardware-accelerated
  encode/decode.
- **Zip downloads** when downloading multiple converted files at once
  uses [fflate](https://github.com/101arrowz/fflate).
- **Fonts**: Inter, loaded from Google Fonts.

## Files

```
index.html   markup + drop zone + queue
style.css    all styling
app.js       all logic (file intake, image + video conversion, UI)
```
