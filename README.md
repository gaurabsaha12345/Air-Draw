# Webcam Air Draw + Gemini Suggestions

Turn your webcam into an air-drawing canvas with hand tracking. Pinch to draw, snap shapes, edit them, erase strokes, tweak visual filters, capture shots, and get live shape suggestions using Google AI Studio (Gemini).

## Features
- Webcam connection with MediaPipe Hands
- Air drawing via pinch (thumb + index)
- Shape snapping: circle, rectangle, triangle
- Edit mode: move, resize, rotate, delete
- Erase mode: remove individual strokes
- Toolbar: color, brush size, show hands, modes
- Undo/redo, clear
- Gemini suggestions; click to insert shapes
- Brightness/Contrast/Saturation adjustments
- Capture snapshots to a gallery

## Quickstart
1) Install Node.js 18+.
2) Install deps:
```bash
npm.cmd install
```
3) Create `.env`:
```bash
GOOGLE_API_KEY=your_gemini_api_key_here
```
4) Run:
```bash
npm.cmd run dev
```
Open `http://localhost:5173` in Chrome and allow camera.

## Scripts
- `npm run dev` — start server

## Tech
- MediaPipe Hands (CDN)
- Express server with `@google/generative-ai` (Gemini 1.5 Flash)
- Vanilla JS + Canvas

## Structure
```
public/
  index.html
  styles.css
  main.js
server.js
package.json
```

## API
POST `/api/recommend-shapes`
- Body: `{ strokes, width, height }`
- Result: `{ suggestions: string[] }`

## Notes
- API key is server-side only (`.env`).
- Video frames stay in browser.

## Deploy to GitHub Pages (frontend only)
GitHub Pages serves static files, so you need to host the API elsewhere (e.g., Render, Railway, Fly.io, or your own VPS) and point the frontend to it.

Steps:
1) Deploy `server.js` to a host that supports Node.js, set `GOOGLE_API_KEY` env var.
2) Get the public base URL, e.g. `https://your-api-host.example.com`.
3) In `public/config.js`, set:
```html
<script>
  window.API_BASE = 'https://your-api-host.example.com';
</script>
```
4) Commit and push.
5) Enable GitHub Pages: Repository → Settings → Pages → Source: `GitHub Actions` or `Deploy from a branch` → `/public` via `main`.
6) Visit `https://<username>.github.io/<repo>/`.

If you prefer Actions, add a workflow that deploys `/public` to Pages.

## License
MIT
