# LaTeX to PNG

Render LaTeX to a high-resolution PNG, then download it or copy it to the clipboard.

**Live:** https://latex-renderer-one.vercel.app

## Features

- Renders most LaTeX math, including AMS environments, `mhchem` (`\ce`), `cancel`, `braket`, `mathtools` and `\tag`.
- `\\` and `\newline` break lines. Lines are centered, or aligned on `&` when the input uses it.
- Exports at 200 px per em (12pt type at 1200 dpi), scaled down only when an expression would exceed browser canvas limits.
- Transparent background by default, with an optional white background.
- **Copy** button, plus <kbd>⌘C</kbd> on macOS or <kbd>Ctrl+C</kbd> elsewhere. If text is selected, the shortcut copies the text as usual.
- The PNG is encoded as you type, so download and copy don't wait.
- Pasted `$…$`, `$$…$$`, `\[…\]` and `\(…\)` delimiters are stripped.

The `physics` package is not enabled, because it redefines standard commands such as `\div`.

## How it works

It's a static site with no build step and no server. [MathJax](https://www.mathjax.org/) renders the input to SVG with glyphs as paths, so the result can be drawn onto a canvas without embedding web fonts. The canvas is then encoded as a PNG.

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `style.css` | Styles |
| `app.js` | Rendering, PNG export, download, copy and shortcut |
| `vendor/mathjax-3.2.2/` | Self-hosted MathJax bundle |
| `vercel.json` | Long-lived caching for the versioned vendor files |

## Run locally

Serve the folder over HTTP:

```bash
python3 -m http.server 4173
```

Then open http://localhost:4173. The clipboard API needs a secure context, so copying works on `localhost` or HTTPS but not from `file://`.

## Deploy

Pushes to `main` deploy to Vercel automatically. Any static host works.

## License

[MIT](LICENSE). MathJax is distributed under the Apache License 2.0; see [`vendor/mathjax-3.2.2/LICENSE`](vendor/mathjax-3.2.2/LICENSE).
