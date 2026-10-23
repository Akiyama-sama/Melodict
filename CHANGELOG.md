# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!TIP]
> Knote (知音) is a fork of Nora by Sandakan. Everything before 4.0.0 is Nora's history — see the upstream repository for those release notes.

## [4.1.1] - 2026-10-24

### Fixed

- Fixed lyrics analysis failing against the official DeepSeek API and other strict OpenAI-compatible endpoints with a 400 "may not support JSON output" error: the request now asks for `json_object` (the broadest structured-output common denominator) instead of `json_schema`, and an endpoint that refuses even that is remembered and asked without the field entirely.
- Replaced the AI SDK with the official OpenAI SDK for the analysis gateway, with streaming element parsing hardened against broken model output: transposed closing brackets, unescaped quotes inside values, truncated tails, and one broken element no longer poisoning its neighbours.
- Fixed reasoning models (DeepSeek flash series) burning the whole output budget on invisible thinking and returning nothing: output budgets gained headroom, a batch that still comes back empty retries once in place, and empty output no longer shrinks the adaptive concurrency window.
- Added a progress-gated second repair wave: a repair pass that recovered some lines but left gaps now runs once more, while a wave that recovered nothing stops instead of burning more tokens.
- Fixed every repair telemetry event being recorded twice.

## [4.1.0-alpha] - 2026-10-23

### Added

- Added NetEase keyword suggestions to the search inputs, with the typed keyword kept on Enter and a scrollable dropdown.
- Added a first-run onboarding card guiding users to the lyrics analysis provider setup.
- Added a local build & auto-upload GitHub Release pipeline (`pnpm release:local`), defaulting to draft releases.
- Added a divider in the sidebar separating local-library routes from the NetEase ones.

### Changed

- Renamed the app to Knote (知音): branding, appId (`io.github.Akiyama-sama.knote`), About page and repository metadata now point at Akiyama-sama/knote.
- Update checks and release notes now read the changelog from the knote repository.
- Rebranded the macOS app icon and defaulted the UI to the light theme with dynamic themes on.
- Moved NetEase to third and lyrics analysis to fourth in the settings navigation.

### Fixed

- Fixed the fullscreen song-info overlay: frosted-glass backdrop, aligned with the lyrics column, no hard edges.
- Fixed the sidebar NetEase labels to drop the redundant prefix (我的歌单 / 我喜欢的音乐 / 排行榜).
- Fixed the agreement dialog text theming in dark mode.
- Fixed the macOS Dock icon rendering oversized.

## [4.0.0-alpha] - 2026-10-17

### Added

- Added the lyrics analysis MVP: per-token romaji/pinyin/kana annotations, a word-detail panel, and AI-driven analysis with a runtime-adaptive concurrency gate (AIMD v2) replacing the fixed cap.
- Added the cross-session concurrency memory and line-level lyrics caching with chorus deduplication.
- Added NetEase QR-code login with a shared prompt, the account widget in the shell top bar, and the shared top-bar search across sidebar routes.
- Added NetEase liked-songs listing (newest first).

### Changed

- Ported the fullscreen player styling and responsive layout from the pre-main branch, excluding the tokenize/lyrics-analysis features (landed later).
- Renamed 歌词 token colour strategy: two palette-derived colours (song-title swatch + the farthest-hue readable swatch) alternating across tokens.

### Fixed

- Fixed worker/envelope/batching failures in the lyrics analysis pipeline.
- Fixed Space/arrow shortcuts matching across UI languages.
