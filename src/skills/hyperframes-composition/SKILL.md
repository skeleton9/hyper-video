---
name: hyperframes-composition
description: Author a renderable HyperFrames HTML short video. Use when turning a topic into a vertical explainer with on-screen copy, and before writing or editing index.html.
---

# HyperFrames composition

HyperFrames renders video from HTML. A composition is an HTML file whose DOM declares timing with `data-*` attributes. Write the project's `projects/<id>/index.html`. Then lint and snapshot — never skip those gates.

Read `template.html` in this skill for the skeleton. Copy its structure; change copy, color, motion, and clip timing.

## Required contract

Standalone `index.html` only (no `<template>` wrapper around the root):

1. Root `div` has `id="root"`, `data-composition-id="main"`, `data-start="0"`, `data-width`, `data-height`, `data-duration`.
2. Root is a sized box (`width`/`height` in px matching the data attributes) with `position: relative; overflow: hidden`.
3. Visible timed elements are **direct children** of the root, with `class="clip"`, unique `id`, `data-start`, `data-duration`, `data-track-index`.
4. Load GSAP from the jsDelivr pin in the template. Register exactly one paused timeline:

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
// tweens…
window.__timelines["main"] = tl;
```

5. Full-frame backgrounds go on a **child** (`position:absolute; inset:0`), never on `#root` itself (root background can render black).
6. Every `id` is unique. No `<br>` in body text — use block elements or `\A` with `white-space: pre-line`.
7. Do not pair a CSS `transform` with a GSAP tween of the same property. Set the start state in `gsap.fromTo`.
8. Animate only visual properties (x/y/scale/rotation/opacity/color/…). Never tween `display` or raw `visibility`. Do not `gsap.set` later-scene clips at page load — the framework owns `.clip` visibility.
9. No `Math.random`, network, clocks, `repeat: -1`, or input-driven animation. Finite repeats only.
10. Transformed elements must be `display: block` (or flex/grid) and explicitly sized.

## Timing

- Times are seconds. Root `data-duration` is the render length.
- Clips on the **same** `data-track-index` must not overlap. Stack layers on different tracks.
- A clip is visible for `start ≤ t ≤ start + duration`.
- Short-video default is 20–45s portrait. Ask before going past ~60s. Sub-10s title stings only if the user asked for a bumper, not a topic explainer.

## Motion

Keep motion decisive and few:

- One entrance (`fromTo` y/opacity, 0.5–0.8s, `power3.out`)
- Optional emphasis (scale 1 → 1.04 or a color shift)
- Optional exit if a later clip replaces it

Do not loop forever. Do not add decorative particles unless the brief asks for them.

## Workflow in this workspace

This studio makes **short videos for creators** (话题 → 资料 → 口播脚本+分镜 → 画面/音频/字幕). Project files live at `projects/<conversation-id>/`.

1. Research and lock the plan with `save_plan` (`RESEARCH.md` + `SCRIPT.md`) before HTML. Use `fetch_source` when there is a URL.
2. Call `init_project` if `index.html` is missing. Default **portrait 1080×1920**, 20–45s.
3. Write `projects/<id>/index.html` from the shot list (big type, one idea per scene). Keep room at the bottom for captions.
4. Call `generate_voiceover` with the spoken script (plain sentences, no markdown). It synthesizes Doubao TTS to `audio/voiceover.mp3` and inserts `<audio id="voiceover">` plus `#caption-*` clips. Skip only for a silent video.
5. Call `lint_composition`. Fix every error before continuing.
6. Call `capture_preview` so the right-hand studio panel updates.
7. Iterate from user notes. If you rewrite `index.html`, call `generate_voiceover` again so audio and captions are reattached.
8. Call `export_video` only when the user asks to export / download / render the mp4.

Do not run raw `hyperframes` shell commands when these tools exist. Do not call the Doubao HTTP API yourself.

## Voice and captions

- `<audio>` is not a visual clip: no `class="clip"`. Do not call `audio.play()`, pause, or seek.
- Caption sections are visual clips: direct children of `#root`, `class="clip"`, unique ids, same `data-track-index` (8), no overlap.
- Leave `#voiceover` and `#caption-*` in the tree. Style captions with `.caption-rail` / `.caption` from the template.
- Match narration to on-screen language. Keep the script under ~400 characters unless the user asked for a longer piece.
- **Never use 「——」 or `--` in 口播, captions, or on-screen copy.** Rewrite: `不是死亡，是爱而不得` not `不是死亡——是爱而不得`.
- Write spoken clauses that can stand as a caption. Caption grouping splits on commas/periods; do not write lines that only make sense if a word is cut in half.
- **On-screen copy wraps at 断句, not mid-word.** Insert a newline (with `white-space: pre-line`) at `，。！？` so each line is about 8–12 字. Never leave `，` / `。` at the start of a line, and never split a word like `伟大` / `拼了命`. Keep `line-break: strict` on titles.

## Copy and design

- Match the user's language.
- One idea per clip. Big type, high contrast, generous padding.
- Prefer a small palette (2–3 colors + one accent).
- Default resolution: portrait 1080×1920. Landscape 1920×1080 and square 1080×1080 only when asked.
