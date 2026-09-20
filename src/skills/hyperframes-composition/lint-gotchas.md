# Lint gotchas

Fix these before snapshot/export.

- Root must include `data-start="0"`. Missing it fails with `root_composition_missing_data_start`.
- Visible clips need `class="clip"` and must be **direct children** of `#root`. A wrapper around a clip makes timing ignored.
- `gsap_css_transform_conflict`: do not set `transform` in CSS on an element GSAP also tweens. Use `fromTo` for the start state.
- Duplicate ids, including `<img>` / `<video>` ids, can render blank.
- Infinite `repeat: -1` is banned. Use a finite count.
- Do not tween `display` or `visibility`. `autoAlpha` is allowed on non-clip wrappers.
- Body text cannot contain `<br>`.
- `<audio>` must not use `class="clip"`. Caption overlays must use `class="clip"` and sit as direct children of `#root`.
- If `hyperframes lint` reports errors, fix the HTML and lint again. Do not snapshot an invalid composition unless you are capturing a known failure for the user.
