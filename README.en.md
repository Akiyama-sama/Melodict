<div align="center">

<img src="resources/logo_light_mode.png" alt="Knote (知音) Logo" width="200">

# Knote (知音)

### Music, understood — an elegant desktop music player that listens, and makes sense of every lyric

Built with Electron and React • Inspired by [Oto Music](https://play.google.com/store/apps/details?id=com.piyush.music&gl=us)

[![GitHub release](https://img.shields.io/github/package-json/v/Akiyama-sama/knote?color=green&label=latest%20version&style=for-the-badge)](https://github.com/Akiyama-sama/knote/releases/latest)
[![GitHub license](https://img.shields.io/github/license/Akiyama-sama/knote?style=for-the-badge)](https://github.com/Akiyama-sama/knote/blob/master/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/Akiyama-sama/knote?style=for-the-badge)](https://github.com/Akiyama-sama/knote/issues)

[Download](#-download) • [Features](#-feature-highlights) • [Build Guide](#%EF%B8%8F-build-from-source) • [Changelog](/CHANGELOG.md) • [简体中文](README.md)

</div>

---

> **Knote (知音)** — in an old Chinese story, a qin player and a listener understood each other through music alone, and a word was born: *zhīyīn*, "to know the song, and be known by it." Knote hands that listening to AI — every word it glosses is one more attentive ear turned to your song. As for the English name: *kin* met *note*, and the K keeps quiet, as in *know* — some understanding is never spoken.

Knote (知音 — "the one who truly understands your music") builds on the Nora upstream and turns the player into a study companion: beyond playing your local library, it analyzes lyrics line by line with AI — every word's meaning, pronunciation (romaji / kana / pinyin / IPA), and grammatical role is one click away, turning every foreign-language song into a text you can actually study.

![Knote · fullscreen lyrics with the word panel](/resources/other/artwork/fullscreen-lyrics-closeup.png)

## ✨ Feature Highlights

**🎵 Player foundation (inherited from Nora)**

- Song / artist / album / playlist library management with smart search and filters
- Synced lyrics, desktop mini lyrics, system media control
- Light / dark themes, cover-derived dynamic theming
- Last.fm scrobbling, Discord Rich Presence

**📖 AI lyrics analysis (Knote's core)**

- Per-word (token) analysis: meaning, part of speech, grammatical function — click any word in the lyrics
- Multi-language pronunciation: Japanese romaji & kana, Korean RR, Chinese pinyin, English IPA (US)
- Human romanization references (e.g. NetEase romalrc) anchor pronunciation and word boundaries
- Results cached per song, chorus lines reused across songs; auto-analyze-while-playing can be toggled off
- Fullscreen "word panel": select any token for its full study card

**🎧 Online sources**

- NetEase Cloud Music sign-in: search, playback, liked songs
- Quality selection; lyrics (including word-level YRC) matched automatically

## 📥 Download

Head to the **[Releases page](https://github.com/Akiyama-sama/knote/releases) > Assets > choose your platform**, or [download the latest version directly](https://github.com/Akiyama-sama/knote/releases/latest).

> [!NOTE]
> Windows and macOS builds are provided; on Linux, run from source.

## 📸 Gallery

### AI lyrics analysis · word panel

Fullscreen lyrics highlight word by word; click any word for its study card: meaning, grammar, pronunciation (KANA / ROMAJI / pinyin / IPA).

![Japanese lyrics · word panel](/resources/other/artwork/word-panel-japanese-wide.png)

![English lyrics · IPA pronunciation](/resources/other/artwork/word-panel-english.png)

![Word panel · closeup](/resources/other/artwork/word-panel-closeup.png)

### Player

![Home · favorites and NetEase daily recommendations](/resources/other/artwork/home-light.png)

![Artist page · dynamic palette theming](/resources/other/artwork/artist-page-light.png)

### Fullscreen lyrics · per-word highlight

The word being sung lights up as it sounds.

![Fullscreen lyrics · word highlight](/resources/other/artwork/fullscreen-lyrics-tokens-macbook.png)

![Fullscreen lyrics · English](/resources/other/artwork/fullscreen-lyrics-english.png)

![Fullscreen lyrics · wide](/resources/other/artwork/fullscreen-lyrics-tilted.png)

## 🛠️ Build From Source

Clone the repository

```bash
git clone https://github.com/Akiyama-sama/knote
```

Navigate to the project folder

```bash
cd knote
```

Install dependencies (pnpm required)

```bash
pnpm install
```

Launch in development mode

```bash
pnpm start
```

> [!TIP]
> If you run into issues (such as `Error: Electron uninstall`), check the [Troubleshooting Guide](docs/TROUBLESHOOTING.md).

## 📄 Open Source License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](https://www.gnu.org/licenses/agpl-3.0.html).

- **Modification & distribution:** any modification or redistribution must also be licensed under **AGPL-3.0**, with the complete source code provided.
- **Derivative works:** must adopt **AGPL-3.0** as well, and must retain this project's license and copyright notice in an appropriate place.
- **Attribution:** the original author and copyright information must be preserved. This project is a fork of [Sandakan/Nora](https://github.com/Sandakan/Nora) (MIT-licensed); its original copyright notice is retained in [open_source_licenses.txt](open_source_licenses.txt).
- **Commercial use:** if used for sale or any other for-profit purpose, the source code and a link to this project must be provided. Because this project relies on third-party services, commercial use may carry legal risk.
- **Warranty:** this software is provided "as is", without warranty of any kind, as detailed in AGPL-3.0.

## ⚠️ Disclaimer

This project is intended **for personal study and research only**; commercial and illegal use is prohibited. Some features rely on third-party APIs (such as online music platforms) and on AI analysis services you configure yourself. Users must ensure on their own that their usage complies with applicable laws and regulations as well as the relevant service agreements. The authors bear no responsibility for any direct or indirect consequences arising from the use of this project.

The app itself does not provide, store, or distribute any audio content; all content comes from your local files, the online platforms you actively sign into, or the AI services you configure. The app does not bypass any platform's paid or permission restrictions. See [docs/agreement.md](docs/agreement.md) for the full User Agreement & Disclaimer, which is also shown inside the app on first launch.

## 🤝 Feedback & Contributing

Found a bug or want a feature? Please reach out through:

- [GitHub Issues](https://github.com/Akiyama-sama/knote/issues) (preferred)

---

<div align="center">

Made with ❤️ by [Akiyama](https://github.com/Akiyama-sama) • [简体中文](README.md)

_All songs, artists, albums, and cover art used in demonstrations are property of their respective owners and used for illustrative purposes only._

</div>
