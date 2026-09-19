# lint.uz — Fast, Private, Beautiful Developer Viewers

> A lightweight suite of 100% client-side, zero-server developer visualizers, formatters, and linters hosted on subdomains of [lint.uz](https://lint.uz).

---

## 🔒 Security & Privacy Guarantee

**Your data never leaves your browser.**

- **100% Client-Side Processing**: All parsing, syntax validation, formatting, minification, and conversion run entirely in your local browser runtime via native Web APIs (`DOMParser`, `JSON.parse`) and bundled zero-telemetry libraries.
- **Zero Remote Storage / Zero Databases**: There are no backend API endpoints, no logs, and no external trackers.
- **Inspectable & Verifiable**: You can open your browser's Developer Tools (`Network` tab) at any time while pasting private keys, production configs, or sensitive JSON/XML/YAML. You will see **0 outbound HTTP requests**.

---

## 🛠️ The Suite

| Subdomain | Description | Features |
| :--- | :--- | :--- |
| **[json.lint.uz](https://json.lint.uz)** | JSON Viewer & Formatter | Collapsible JSON tree, search, format, minify, path copy |
| **[xml.lint.uz](https://xml.lint.uz)** | XML Viewer & Formatter | XML node tree, XPath extractor, XML ↔ JSON, line/column error locator |
| **[yaml.lint.uz](https://yaml.lint.uz)** | YAML Viewer & Formatter | Indentation validator, YAML ↔ JSON two-way conversion, visual hierarchy |

---

## 🚀 Deployment & CI/CD Architecture

Every tool is deployed to **Cloudflare Workers with Static Assets** across subdomains of `lint.uz`.

Whenever changes are pushed to the `main` branch, **GitHub Actions** automatically deploys the updated directory to Cloudflare Edge in seconds.

---

## 💻 Local Development

```bash
# Clone the repository
git clone https://github.com/saidkamolxon/lint.uz.git
cd lint.uz

# Test locally with Wrangler
cd yaml
npx wrangler dev
```

---

## 📄 License

MIT License. Free and open source.
