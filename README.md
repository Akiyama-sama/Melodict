<div align="center">

<img src="resources/other/nora_logo_banner.webp" alt="知音 Logo" width="480">

# 知音 Knote

### 用旋律来记住单词 —— 一款会「听歌」，更会「懂歌」的桌面音乐播放器

基于 Electron 与 React 构建 • 灵感来源于 [Oto Music](https://play.google.com/store/apps/details?id=com.piyush.music&gl=us)

[![GitHub release](https://img.shields.io/github/package-json/v/Akiyama-sama/Melodict?color=green&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC&style=for-the-badge)](https://github.com/Akiyama-sama/Melodict/releases/latest)
[![GitHub license](https://img.shields.io/github/license/Akiyama-sama/Melodict?style=for-the-badge)](https://github.com/Akiyama-sama/Melodict/blob/master/LICENSE)
[![GitHub issues](https://img.shields.io/github/issues/Akiyama-sama/Melodict?style=for-the-badge)](https://github.com/Akiyama-sama/Melodict/issues)

[下载](#-下载) • [功能](#-功能亮点) • [构建指南](#-从源码构建) • [更新日志](/CHANGELOG.md) • [English](README.en.md)

</div>

---

知音（Knote）在 Nora 上游的基础上把「播放器」推进为「学习伙伴」：它不只是把你的本地音乐放出来，还用 AI 逐句解析歌词——每个词的释义、读音（罗马音 / 假名 / 拼音 / IPA）、语法功能一一点开即得，让每一首外语歌都变成可精读的课文。

![知音主界面](/resources/other/artwork%200.webp)

## ✨ 功能亮点

**🎵 播放器基座（继承自 Nora）**

- 歌手 / 专辑 / 歌单库管理，智能搜索与筛选
- 同步歌词逐行滚动、桌面迷你歌词、系统级媒体控制
- 亮 / 暗主题，封面取色的动态主题
- Last.fm Scrobbling、Discord Rich Presence

**📖 AI 歌词解析（知音的核心）**

- 逐词（Token）解析：释义、词性、语法功能，点击歌词中的词即得
- 多语种读音标注：日语罗马音与假名、韩语罗马字、中文拼音、英语 IPA（美音）
- 人工罗马音参照（如网易云 romalrc）作为读音基准对齐分词
- 解析结果按歌曲缓存，副歌跨歌复用；播放中自动解析可一键关闭
- 全屏歌词「词语面板」：选中任意词查看完整学习卡片

**🎧 在线音源**

- 网易云音乐账号登录：搜索、播放、喜欢的音乐
- 多音质选择，歌词（含逐字 YRC）自动匹配

## 📥 下载

前往 **[Releases 页面](https://github.com/Akiyama-sama/Melodict/releases) > Assets > 选择你的平台**，或[直接下载最新版本](https://github.com/Akiyama-sama/Melodict/releases/latest)。

> [!NOTE]
> 目前仅提供 Windows 与 macOS 构建；Linux 可从源码运行。

## 📸 界面预览

![在线与离线歌词](/resources/other/artwork%201.webp)

![亮暗主题切换](/resources/other/artwork%202.webp)

![轻松管理音乐库](/resources/other/artwork%203.webp)

![迷你播放器](/resources/other/artwork%208.webp)

## 🛠 从源码构建

克隆仓库

```bash
git clone https://github.com/Akiyama-sama/Melodict
```

进入项目目录

```bash
cd Melodict
```

安装依赖（需要 pnpm）

```bash
pnpm install
```

以开发模式启动

```bash
pnpm start
```

> [!TIP]
> 如果遇到问题（例如 `Error: Electron uninstall`），请查阅[故障排除指南](docs/TROUBLESHOOTING.md)。

## 📄 开源许可

本项目基于 [GNU Affero 通用公共许可证 v3.0（AGPL-3.0）](https://www.gnu.org/licenses/agpl-3.0.html)授权。

- **修改与分发：** 任何修改或再分发同样必须以 **AGPL-3.0** 授权，并提供完整源代码。
- **衍生作品：** 同样须采用 **AGPL-3.0**，并在适当位置保留本项目的许可与版权声明。
- **署名：** 须保留原作者与版权信息。本项目 fork 自 [Sandakan/Nora](https://github.com/Sandakan/Nora)（MIT 许可），其原始版权声明保留于 [open_source_licenses.txt](open_source_licenses.txt)。
- **商业使用：** 若用于销售或其他营利目的，须提供源代码及本项目链接。由于本项目依赖第三方服务，商业使用可能存在法律风险。
- **免责声明：** 本软件按「原样」提供，不含任何担保，详见 AGPL-3.0 条文。

## ⚠️ 免责声明

本项目**仅供个人学习与研究使用**，禁止商业与违法用途。部分功能依赖第三方 API（如在线音乐平台）及用户自行配置的 AI 解析服务，用户须自行确保其使用符合所在法律法规与相关服务条款。因使用本项目产生的任何直接或间接后果，作者不承担责任。

本应用本身不提供、不存储、不分发任何音频内容；所有内容均来自你的本地文件、你主动登录的在线平台，或你自行配置的 AI 服务。本应用不绕过任何平台的付费或权限限制。完整《用户协议与免责声明》见 [docs/agreement.md](docs/agreement.md)，应用首次启动时也会展示。

## 🤝 反馈与贡献

发现 Bug、想要新功能？欢迎通过以下方式反馈：

- [GitHub Issues](https://github.com/Akiyama-sama/Melodict/issues)（推荐）

---

<div align="center">

由 [Akiyama](https://github.com/Akiyama-sama) 用 ❤️ 制作 • [English](README.en.md)

_演示中出现的所有歌曲、歌手、专辑与封面版权归其各自所有者所有，仅作说明用途。_

</div>
