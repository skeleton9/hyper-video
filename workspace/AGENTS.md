# Hyper Video workspace

This sandbox is the HyperFrames project workspace for the VideoDirector agent.

## Layout

- `projects/<conversation-id>/` — one HyperFrames project per chat
- `projects/<conversation-id>/index.html` — the composition to lint, snapshot, and render
- `projects/<conversation-id>/project.json` — studio metadata (title, preview, export)
- `projects/<conversation-id>/snapshots/` — still frames for the web preview
- `projects/<conversation-id>/exports/video.mp4` — exported file

- `projects/<conversation-id>/audio/voiceover.mp3` — Doubao TTS narration
- `projects/<conversation-id>/captions.json` — timed caption cues

## Rules

Use the agent's tools (`init_project`, `generate_voiceover`, `lint_composition`, `capture_preview`, `export_video`) instead of inventing HyperFrames CLI flags. Write real, renderable HTML. Keep ids unique. Direct-child clips only. Keep `#voiceover` and `#caption-*` after generating voice.
