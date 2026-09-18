# Neon Drift

Neon Drift is a self-contained browser game with no build step or external dependencies. `index.html` is the GitHub Pages entry point; `neon-drift-easy.html` remains the editable source copy.

## Run locally

Requirements: Node.js 18 or newer.

```powershell
npm start
```

Open <http://127.0.0.1:8000/> in a browser. Set `PORT` to use another port, for example:

```powershell
$env:PORT=8080; npm start
```

## GitHub Pages

Publish the repository root with GitHub Pages. It will serve `index.html` directly; `server.js` is only for local development.