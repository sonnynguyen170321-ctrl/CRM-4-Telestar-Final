---
classification: CURRENT_REFERENCE
note: Typography system reference. The enforced rules live in .claude/rules/frontend-ux.md.
---

# TELESTAR DESIGN SYSTEM — TYPOGRAPHY ARCHITECTURE

**Document Version**: 1.0.0  
**Directive**: Telestar Typography Transformation  
**Status**: Shipped Production Standard  

---

## 1. Dual-Voice Brand Architecture

| Voice Domain | Font Family | Role & Usage | Fallback Stack |
| :--- | :--- | :--- | :--- |
| **Brand Identity** | **Futura** (`--font-brand`) | Wordmarks, top-level route titles (`<h1>`), high-impact cards, hero KPIs | `'Futura', 'Futura PT', 'Futura-Medium', 'Trebuchet MS', var(--font-montserrat), sans-serif` |
| **Primary Operating** | **Montserrat** (`--font-sans`) | All UI chrome, tables, form fields, navigation, buttons, tooltips, body copy, AI generation text | `var(--font-montserrat), 'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` |
| **Technical Monospace**| **JetBrains Mono** (`--font-mono`)| API keys, tokens, technical IDs, JSON data, code blocks | `var(--font-mono), 'JetBrains Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace` |

---

## 2. Standardized 6-Tier Type Scale

| Tier Token | Pixel Size | Font Weight | Line Height | Usage Scope |
| :--- | :--- | :--- | :--- | :--- |
| `--text-page-title` | **28px** | 700 (Bold) | 1.2 | One main page `<h1>` per route |
| `--text-section` | **20px** | 600 (Semibold) | 1.3 | Panel & major card headers |
| `--text-subsection` | **16px** | 600 (Semibold) | 1.4 | Group labels & modal subheaders |
| `--text-body` | **14px** | 400 (Regular) | 1.5 | Paragraphs, table cell data, form values |
| `--text-meta` | **13px** | 500 (Medium) | 1.4 | Navigation items, timestamps, secondary metrics |
| `--text-micro` | **11.5px** | 600 (Semibold) | 1.3 | Badges, status pills, keyboard shortcuts |

---

## 3. Tabular Numerals & High-Density Alignment

Financial data, lead pacing percentages, countdown timers, and SDR table metrics enforce tabular numeric spacing via `.tabular-nums` (`font-variant-numeric: tabular-nums`). This guarantees decimal alignment and prevents layout jitter during real-time data streaming.

---

## 4. International & Multilingual Glyph Support

The self-hosted build incorporates full Latin and Vietnamese diacritics character sets (`['latin', 'vietnamese']`), guaranteeing pristine rendering across international B2B SDR campaigns without font replacement or square fallback glyphs.
