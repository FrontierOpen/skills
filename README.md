# Frontier World Skills

Reusable, production-oriented Codex Skills maintained by Frontier World in the [FrontierOpen](https://github.com/FrontierOpen) GitHub organization.

This repository covers the content operations loop: sourcing and research, production, publication, and performance evaluation, plus a standalone Xiaohongshu cover renderer.

## Available skills

| Skill | Description | Status |
| --- | --- | --- |
| [`expert-wx-mp`](./expert-wx-mp/) | WeChat Official Account operations expert: positioning, style DNA, content production, layout, publishing, and data review, with nested tools for profiling, theming, publishing, and engagement scraping. | Active |
| [`wx-mp-hunter`](./wx-mp-hunter/) | Collects WeChat Official Account content: full article text by URL, recent post lists per account, and article links from topic or album pages. | Active |
| [`published-track`](./published-track/) | SQLite-backed publication ledger across platforms, recording published works, DNA attribution, and engagement metrics. | Active |
| [`content-calibrator`](./content-calibrator/) | DNA performance evaluation engine: consumes `published-track` data, normalizes against per-account baselines, and produces trend-first evaluation reports and DNA revision proposals. | Active |
| [`xhs-cover-generator`](./xhs-cover-generator/) | Renders text-driven 1080×1440 Xiaohongshu covers and multi-page 图文 decks with built-in layouts, palettes, and JSON customization. | Active |

## How the skills fit together

```text
wx-mp-hunter  →  expert-wx-mp  →  published-track  →  content-calibrator
 (sourcing)      (production)      (publication log)     (DNA evaluation)
                                                              │
                                              DNA revisions ←─┘
```

`xhs-cover-generator` is independent and can be used on its own for Xiaohongshu visuals.

## expert-wx-mp

End-to-end WeChat Official Account operations, driven by workflows in `workflows/`:

- `style-dna` — build and update content DNA from samples and benchmarks;
- `content-production` — draft articles and image posts from ideas, references, or existing drafts;
- `account-setup` — positioning, content pillars, and diagnosis of existing accounts;
- `account-benchmark` — competitor account and article analysis against a DNA;
- `editing` — revision, polishing, tone and layout changes;
- `review` — WeChat-specific data review and DNA evaluation.

Nested tools under `tools/` handle discrete jobs: `wechat-style-profiler` (17-dimension style DNA reports), `generate-wenyan-theme` (layout CSS themes), `wx-mp-publisher` (Markdown to draft box), and `wx-mp-engagement` (creator dashboard metrics).

## wx-mp-hunter

Three collection modes, none of which require a logged-in session:

- `fetch <url>` — full article text from an `mp.weixin.qq.com` link;
- `posts-list` — recent posts for given accounts over a time window;
- `homepage <url>` — article links from a topic, homepage, or album page.

Video Accounts, comments, and engagement metrics are out of scope.

## published-track

A single SQLite database at `./db/published_track.db`, with one table per platform (WeChat Official Account, Video Accounts, Zhihu, Bilibili, Douyin, Kuaishou, Xiaohongshu, Twitter/X, and more). Each record carries the source folder, publish URL and date, distribution status, per-platform engagement metrics, and the DNA attribution fields (`dna_id`, `account`, `perf_evaluated`) consumed by `content-calibrator`.

## content-calibrator

Evaluates whether a content DNA is working, on four rules: trends over absolute values, scripts supply evidence rather than conclusions, confounders are ruled out before attribution, and DNA updates require item-by-item user confirmation. Evaluation triggers by volume (at least five mature, unevaluated records per platform and DNA) or manually via `--force`. Platform-specific attribution methods come from each platform expert's review workflow, not from this skill.

## xhs-cover-generator

`xhs-cover-generator` renders covers and carousels locally with HTML/CSS and a local Chrome, Chromium, or Edge install:

- six built-in cover templates addressed by stable keys (`thinking`, `dialog`, `emotion`, `quote`, `note`, `list`);
- four color themes that can be swapped without changing the layout;
- custom templates supplied as JSON;
- multi-page 图文 decks generated from a single JSON file, including the nine-page `deck-xhs-post` example;
- a local editor for interactive iteration.

See [`xhs-cover-generator/README.md`](./xhs-cover-generator/README.md) for the template gallery, CLI reference, JSON schema, and editor usage.

## Repository structure

```text
skills/
├── README.md
├── content-calibrator/
│   ├── SKILL.md                 # Evaluation rules, triggers, and report structure
│   ├── content-calibrator.sh    # Top-level wrapper
│   └── scripts/                 # Aggregation, baseline, and trend computation
├── expert-wx-mp/
│   ├── SKILL.md                 # Operations entry point and tool index
│   ├── workflows/               # Style DNA, production, setup, benchmark, editing, review
│   └── tools/                   # Nested profiler, theme, publisher, and engagement tools
├── published-track/
│   ├── SKILL.md                 # Schema, platform tables, and usage
│   ├── published-track.sh       # Top-level wrapper
│   ├── references/              # Platform constraints
│   └── scripts/                 # Record, metrics, query, and migration scripts
├── wx-mp-hunter/
│   ├── SKILL.md                 # Collection workflows and agent constraints
│   ├── wx-mp-hunter.sh          # Top-level wrapper
│   └── scripts/                 # Fetch, posts-list, and homepage collection
└── xhs-cover-generator/
    ├── SKILL.md                 # Xiaohongshu cover and 图文 deck instructions
    ├── README.md                # Template gallery and CLI usage
    ├── agents/                  # Agent-facing metadata
    ├── assets/                  # Templates, deck examples, and preview images
    ├── references/              # Copywriting, design, and deck schema guidance
    └── scripts/                 # Deterministic HTML/CSS renderers
```

## Installation

Clone the repository:

```bash
git clone https://github.com/FrontierOpen/skills.git
cd skills
```

Copy or link the skill directory you want into the skills directory used by your Codex environment:

```bash
ln -s /path/to/skills/expert-wx-mp /path/to/codex-home/skills/expert-wx-mp
ln -s /path/to/skills/xhs-cover-generator /path/to/codex-home/skills/xhs-cover-generator
```

Read the selected skill's `SKILL.md` before use. Files under `assets/` are templates, previews, and structural fixtures, not current production data.

### Requirements

| Skill | Requires |
| --- | --- |
| `expert-wx-mp` | Python 3, Node.js, an authorized WeChat Official Account session for publishing and engagement scraping |
| `wx-mp-hunter` | Python 3; `posts-list` additionally needs a local WeChat client container |
| `published-track` | Bash, SQLite 3 |
| `content-calibrator` | Bash, SQLite 3, Python 3 |
| `xhs-cover-generator` | Node.js and a local Chrome, Chromium, or Edge install; no npm dependencies |

## Usage

Collect a source article and the recent posts of an account:

```bash
wx-mp-hunter fetch https://mp.weixin.qq.com/s/xxxx
wx-mp-hunter posts-list --recent 20 --accounts 某公众号
```

Record a publication and inspect the ledger:

```bash
published-track init-db

published-track record \
  --platform wx_mp \
  --title "标题" \
  --content-type article \
  --source-folder "wx_mp/outputs/xxx" \
  --publish-url "https://mp.weixin.qq.com/s/xxx" \
  --account <account-alias>

published-track query-pending --platform wx_mp
```

Check whether a platform has enough mature records to evaluate, then run the evaluation:

```bash
content-calibrator eval --platform wx_mp --check
content-calibrator eval --platform wx_mp
```

Render a Xiaohongshu cover from the `xhs-cover-generator` directory:

```bash
node scripts/make-cover.mjs --list

node scripts/make-cover.mjs \
  --template thinking \
  --theme braun \
  --main "5个AI工具\n让工作效率翻倍" \
  --highlight "AI工具" \
  --tag "实测有效" \
  --emoji "⚡" \
  --out out/cover.png
```

## Development standards

- Keep each skill self-contained and independently understandable.
- Keep deterministic validation and rendering logic in scripts.
- Document editorial rules, external services, permissions, and failure behavior in `references/`.
- Treat example inputs as structural fixtures, never as current production facts.
- Keep platform-specific attribution inside the relevant platform expert, not inside shared engines.
- Do not bypass validation, DNA confirmation, or publication approval gates.
- Do not commit credentials, authentication state, databases, generated working files, operating-system metadata, or private user data.

## Contributing

Issues and pull requests are welcome. Contributions should include:

1. A focused use case and clear trigger conditions.
2. Updated instructions and references for changed behavior.
3. Regression tests for deterministic scripts.
4. Explicit permission and failure rules for external integrations.
5. No secrets, personal information, or environment-specific runtime data.

## Security

Never commit API keys, access tokens, browser sessions, account configuration with real credentials, publication databases, private documents, or production data. `accounts.example.json` and similar files are templates; keep real account configuration outside the repository. Publishing and engagement scraping require an explicitly authorized account session. If a credential is exposed, revoke it immediately and report the incident through the repository’s security channel rather than a public issue.
