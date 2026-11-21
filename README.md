# SELENE — Lunar Tactical Autobattler

[简体中文](README.zh-CN.md) · [Source release guide](docs/github-release.md)

A browser-based tactical game built with TypeScript, Vite and Three.js. Recruit a force, arrange it on the lunar battlefield, set orders and watch the battle unfold.

## Campaign

- Four consecutive missions share **$140**. There is no income between missions.
- Start with an empty army. Surviving units enter the next mission fully restored; casualties are lost.
- Each map changes the deployment problem: a broad outpost front, two crater flanks, an L-shaped industrial staging area and a fortified courtyard.
- Ten unit classes, terrain-aware navigation, cover, armor and configurable targeting priorities.
- The final mission is a two-wave defense against attacks from five directions.
- A loading screen and a skippable, interactive deployment tutorial introduce the controls.
- The level editor supports terrain, buildings, both armies, orders, undo/redo, manual JSON import/export and trial battles.

The game has no login, server, analytics or automatic persistence. Refreshing starts a new campaign and clears editor changes. Manually exported JSON files are the only saved player content.

## Run locally

Use **Node.js 22.12 or newer** and npm. A desktop browser with WebGL 2, a mouse and a keyboard is recommended.

```bash
npm ci
npm run dev:public
```

Open the URL printed by Vite. The public edition offers **English** and **Português (Brasil)**. To use the development edition, which also includes Simplified Chinese, run `npm run dev`.

The macOS launcher `启动试玩.command` starts the development edition and installs dependencies if needed.

## Controls

| Action | Control |
| --- | --- |
| Recruit and place | Click a unit card, then click inside a cyan deployment zone |
| Move a deployed unit | Left-drag the unit |
| Rotate / withdraw | `R` / `Delete` |
| Set behavior and target priority | Select a friendly unit and use its command panel |
| Change camera | `1`, `2`, `3` |
| Orbit / zoom / pan | Right-drag / wheel / middle-drag |
| Pause battle | `Space` |
| Skip tutorial | Tutorial × button or `Escape` |
| Replay tutorial | `?` → Replay tutorial, during deployment |

The tutorial uses normal campaign purchases. Selecting a card is free; a valid placement spends its displayed price. Canceling a new recruit before battle refunds it. Veterans can be moved into reserve and redeployed for free.

## Build and host

```bash
npm run build:public
npm run preview -- --outDir dist-public
```

Publish the contents of **`dist-public/`** to a static host. Its `index.html` must be at the site root. Assets use relative URLs, including when hosted under a repository subpath. No server-side routes, database or environment variables are needed.

Use `build:public` for an English / Brazilian Portuguese public site. The ordinary `build` command creates the three-language development edition in `dist/`.

For Cloudflare packaging and upload, see [deployment instructions](docs/cloudflare-deploy.md). The source archive does not contain prebuilt site files. Hosting providers may keep their own access logs; browsers may cache static assets.

## Offline edition

```bash
npm run build:offline
```

This creates **`试玩.html`**, a self-contained HTML file using the three-language development edition. Open it directly in a WebGL 2 browser. Generated files are excluded from the source archive.

## Checks

```bash
npm run check
npm test
```

The eight suites cover combat, campaign economy, navigation, editor data and simulation, localization, public language restrictions, tutorial positioning and mission maps. These checks run without a WebGL browser and do not replace visual or pointer-input acceptance testing.

A continuous campaign reference strategy can be evaluated with:

```bash
npm run analyze:economy -- --seeds 24 --output campaign-results.json
```

The latest recorded map revision cleared 24/24 seeded runs, spending $103–133. This is scripted strategy feasibility, not a human win rate or a minimum-cost claim.

## Source archive

```bash
npm run package:github
```

Python 3 is required only for creating this ZIP. It writes `selene-github-source.zip` and a SHA-256 checksum. The archive contains source code, tests, scripts, locked dependencies, documentation and the latest static map geometry diagnostics. It excludes `node_modules`, compiled output, offline HTML, machine-specific tooling and old production screenshots.

Extract the ZIP before uploading its project contents to a GitHub repository. [Upload and verification steps](docs/github-release.md).

## Project layout

```text
src/          Game, simulation, terrain, rendering, UI and localization
scripts/      Test runners, offline build and release packaging
tests/       Headless regression checks
docs/        Design notes, deployment instructions and campaign results
art-direction/map-differentiation/
              Static geometry diagnostics, not WebGL screenshots
```

Direct dependency versions are pinned to the verified installation: Three.js 0.186.1, @types/three 0.186.0, TypeScript 7.0.2 and Vite 8.3.4. `package-lock.json` includes package URLs, integrity hashes and platform-specific optional packages. They are not presented as the latest upstream versions.

The project license has not been selected. Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
