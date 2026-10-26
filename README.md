# dsh-locale-multilingual

Adds four UI languages to **DeepSeek Harness (DSH)**: **繁體中文 (台灣)**, **日本語**, **한국어**, **Français**.

Once installed they show up under `Settings → General → Language`.

**Fully offline.** No model API is called and no quota is consumed. The Traditional Chinese dictionary
is produced at runtime by OpenCC; the other three are static JSON files shipped in this repository.

[中文说明在下方 ↓](#中文)

---

## English

### Why this exists

DSH ships only two UI locales (`zh` and `en`). Its locale service exposes a registration API for
additional language packs, but no dictionaries are provided, so this plugin fills the gap.

> `DSH Desktop/locales/zh-TW.pak` is Electron/Chromium's own locale pack. It controls native menus
> and file dialogs, not DSH UI strings, and is **not** a substitute for this plugin.

### Where the translations come from

| Language | Source | Notes |
|---|---|---|
| 繁體中文 (`zh-TW`) | Runtime **OpenCC** conversion (`cn → twp`) | Deterministic and offline; handles glyphs (裡/著/髮) and Taiwan vocabulary (資訊/程式/檔案/滑鼠). No static file |
| 日本語 (`ja`) | `lang/ja.json` | Shipped in this repository |
| 한국어 (`ko`) | `lang/ko.json` | Shipped in this repository |
| Français (`fr`) | `lang/fr.json` | Shipped in this repository |

Structure of `lang/*.json`:

```json
{
  "dicts": { "<namespace>": { "<key>": "<translation>" } },
  "texts": { "<original simplified-Chinese string>": "<translation>" }
}
```

- `dicts` backs the locale service dictionaries (61 namespaces, 3415 entries);
- `texts` backs the UI whitelist (147 strings from plugins that never go through dictionaries).

All three files cover exactly the same surface as `zh-TW`: same namespaces, same keys, same
whitelist strings. There is no generation script, because the translations are a one-off manual
artefact; correctness is enforced by comparing key sets.

### How it works

DSH UI text comes from three different sources, so there are three channels.

#### ① Locale dictionaries (most official packages)

| Side | Responsibility |
|---|---|
| Browser | Registers the four locales (`zh-TW` falls back to `zh`; `ja`/`ko`/`fr` fall back to `en`), collects the simplified-Chinese entries each package registers, fetches translations, and registers them back under the original namespace |
| Host | Converts Traditional Chinese with OpenCC on the fly; for the others it reads `lang/<locale>.json` (cached by mtime, so editing the file takes effect immediately) |

#### ② Title bar menus (not in any dictionary)

The `应用` / `编辑` items at the top of the window are drawn by the preload inside a shadow DOM and
never pass through the locale service, so they are patched directly: locate
`[data-dsh-windows-menu]` and write the label for the active locale.

#### ③ UI string whitelist (plugin copy that bypasses dictionaries)

Some third-party copy — the workbench market page, for example — is hardcoded in the plugin, so it is
patched by **exact string matching**: only text nodes/attributes identical to a whitelist entry are
replaced. Session titles and message bodies are therefore never touched; conversation content always
stays in its original language.

Both DOM channels **pierce shadow DOM** and re-scan every 1.5 s. The title bar and some panels mount
after startup, and mutations inside a shadow root never reach a `MutationObserver` attached to
`document.body`.

### Installation

**From GitHub (recommended):**

```bash
dsh plugin add <your-github-user>/dsh-locale-multilingual
```

A full URL also works: `dsh plugin add https://github.com/<user>/dsh-locale-multilingual`.

Restart DSH, then pick a language under `Settings → General → Language`.

**From a local directory (development / personal use):**

```jsonc
{
  "dependencies": { "dsh-locale-multilingual": "file:C:/path/to/dsh-locale-multilingual" },
  "dsh": { "profile": { "bundles": ["dsh-locale-multilingual"] } }
}
```

Then restart DSH.

**Uninstall:** drop `dsh-locale-multilingual` from `dsh.profile.bundles` (and from the dependencies),
then restart.

### Limitations

- **Conversation content is never translated.** Session titles, message bodies and card contents stay
  in their original language; the whitelist only matches exact UI strings.
- **Native menus are out of scope.** Electron's own menu bar and file dialogs come from
  `locales/*.pak`, which this plugin does not touch.
- **`zh-TW` is not stored on disk.** Only `ja.json` / `ko.json` / `fr.json` exist under `lang/`;
  Traditional Chinese is converted on demand.
- **Translation quality.** The `ja` / `ko` / `fr` files are hand-maintained; terminology follows the
  wording already used in the UI. Corrections via Issues are welcome.

### Repository layout

```
dsh-locale-multilingual/
├── client.js                  # Browser half: registers locales, collects entries, patches DOM
├── lib/index.js               # Host half: OpenCC, local language files, HTTP routes
├── lang/                      # ja.json / ko.json / fr.json
├── ui-strings.json            # UI whitelist (147 strings)
├── scripts/verify.mjs         # Self-check: coverage parity across languages
├── .github/workflows/verify.yml
├── cordis.patch.yml           # bundle patch declaration
├── package.json
├── LICENSE
└── README.md
```

### Self-check

```bash
npm run verify        # same as: node scripts/verify.mjs
```

It checks four things, with no third-party dependencies:

1. every `lang/*.json` parses and has both `dicts` and `texts`;
2. the namespace and key sets are **identical** across all three languages;
3. the whitelist key sets are **identical** across all three languages;
4. the `load({ id })` in `client.js`, the `id` in `cordis.patch.yml` and `name` in `package.json`
   all match — a mismatch makes the plugin load without registering, silently.

It deliberately checks parity *between* languages rather than against a hardcoded DSH snapshot,
because DSH adds and removes strings over time and such a snapshot would rot. To pin parity against a
specific DSH version, pass a snapshot with `--baseline <file>`:

```json
{ "dicts": { "<namespace>": ["<key>", "..."] }, "texts": ["<original string>", "..."] }
```

The most common way to break this repo is adding a key to one language file only; the script stops
that before it lands, and CI runs it on every push and pull request.

### License

MIT — see [LICENSE](LICENSE).

---

# 中文

给 **DeepSeek Harness（DSH）** 加四种界面语言：**繁體中文（台灣）**、**日本語**、**한국어**、**Français**。

装好之后，`设置 → 一般 → 语言` 里会多出这四项。

**完全离线**：不调用任何模型接口，也不消耗任何额度。四种语言的语料要么在运行时由 OpenCC 转换，
要么是打包在仓库里的本地语言文件。

## 为什么需要它

DSH 本体只发行两种界面语言（`zh` 和 `en`）。DSH 的 locale 服务留了语言包注册接口，
但官方没有提供其它语言的词典，所以这个插件补上。

> 顺带说明：`DSH Desktop/locales/zh-TW.pak` 是 Electron/Chromium 自己的语言包，
> 管的是原生菜单和文件对话框，跟 DSH 界面文案无关，不能替代这个插件。

## 四种语言从哪来

| 语言 | 方式 | 说明 |
|---|---|---|
| 繁體中文（`zh-TW`） | 运行时 **OpenCC** 字形转换（`cn → twp`） | 离线、确定性；处理字形（裡/著/髮）与台湾用词（資訊/程式/檔案/滑鼠）。不生成静态文件 |
| 日本語（`ja`） | 本地文件 `lang/ja.json` | 打包在仓库里 |
| 한국어（`ko`） | 本地文件 `lang/ko.json` | 打包在仓库里 |
| Français（`fr`） | 本地文件 `lang/fr.json` | 打包在仓库里 |

`lang/*.json` 的结构：

```json
{
  "dicts": { "<namespace>": { "<key>": "<译文>" } },
  "texts": { "<简中原字符串>": "<译文>" }
}
```

- `dicts` 对应 locale 服务的词典（61 个 namespace、3415 个词条）；
- `texts` 对应界面白名单（147 条不走词典的外挂文案）。

三种语言文件与繁中**同源同范围**：同样的 namespace、同样的 key、同样的白名单字符串。
仓库里没有生成脚本，因为翻译是一次性人工产物；校验方式是比对 key 集合必须与繁中完全一致。

## 它怎么工作

DSH 的界面文案有三种来源，所以这里也有三条通道。

### ① 走 locale 词典的（绝大多数官方套件）

| 半边 | 职责 |
|---|---|
| 浏览器端 | 注册四种语言（`zh-TW` fallback → `zh`；`ja`/`ko`/`fr` fallback → `en`），收集各界面的简中词条，按语言取回译文后注册回原 namespace |
| 宿主端 | 繁中走 OpenCC 现算；其余读 `lang/<locale>.json`（按 mtime 缓存，改文件即生效） |

### ② 标题栏菜单（不在词典里）

窗口顶部那排 `应用` / `编辑` 由 preload 的 shadow DOM 绘制，不经过 locale 服务，
所以只能直接改 DOM：定位 `[data-dsh-windows-menu]`，按当前语言写入对应文案。

### ③ 界面白名单（不经过词典的外挂文案）

工作台市场那批文案是外挂里写死的字符串，同样只能改 DOM。做法是**逐字精确匹配**：
只有与白名单完全相同的文本节点/属性才会被替换，所以会话标题、消息内容不会被误翻
（你在聊天里看到的对话内容永远保持原样）。

两条 DOM 通道都会**穿透 shadow DOM**，并每 1.5 秒兜底补扫一次——因为标题栏和部分面板
是在启动之后才挂上的，且 shadow 内的变化不会触发挂在 `document.body` 上的 MutationObserver。

## 安装

### 方式一：从 GitHub 安装（推荐）

```bash
dsh plugin add <你的GitHub用户名>/dsh-locale-multilingual
```

也可以给完整地址 `dsh plugin add https://github.com/<用户名>/dsh-locale-multilingual`。

装完重启 DSH，在 `设置 → 一般 → 语言` 里选择。

### 方式二：本地目录安装（开发/自用）

在 profile 的 `package.json` 里加依赖并挂载：

```jsonc
{
  "dependencies": { "dsh-locale-multilingual": "file:C:/path/to/dsh-locale-multilingual" },
  "dsh": { "profile": { "bundles": ["dsh-locale-multilingual"] } }
}
```

然后重启 DSH。

### 卸载

把 `dsh-locale-multilingual` 从 `dsh.profile.bundles` 里删掉（以及依赖），重启即可。

## 已知限制

- **不翻译对话内容**：会话标题、消息正文、pmp 之类的卡片内容都保持原文；
  界面白名单只做精确匹配，不会命中这些内容。
- **原生菜单**：Electron 自己的菜单栏/文件对话框由 `locales/*.pak` 决定，本插件不涉及。
- **繁中不落盘**：`lang/` 下只有 `ja.json` / `ko.json` / `fr.json` 三个文件；
  繁中是运行时按需转换的。
- **翻译质量**：`ja` / `ko` / `fr` 为人工整理产物，术语优先与界面既有用词对齐；
  发现译法不当时欢迎提 Issue。

## 目录结构

```
dsh-locale-multilingual/
├── client.js                  # 浏览器半端：注册语言、收集词条、改标题栏与白名单
├── lib/index.js               # 宿主半端：OpenCC 转换 / 读取本地语言文件 / HTTP 路由
├── lang/                      # ja.json / ko.json / fr.json
├── ui-strings.json            # 界面白名单（147 条）
├── scripts/verify.mjs         # 自检：三种语言覆盖率是否一致
├── .github/workflows/verify.yml
├── cordis.patch.yml           # bundle patch 挂载声明
├── package.json
├── LICENSE
└── README.md
```

## 自检

```bash
npm run verify        # 等价于 node scripts/verify.mjs
```

它检查四件事，不依赖任何第三方包：

1. 每个 `lang/*.json` 结构合法；
2. 三种语言之间的 namespace 与 key 集合**完全相同**；
3. 三种语言的界面白名单 key 集合**完全相同**；
4. `client.js` 的 `load({ id })`、`cordis.patch.yml` 的 `id` 与 `package.json` 的 `name` 一致
   （不一致会导致插件加载了却不注册，且没有任何报错）。

只做「互相一致」而不和 DSH 硬比，是因为 DSH 升级会增删词条，硬编码一份快照只会不断过期。
需要跟某个 DSH 版本对齐时，可以用 `--baseline <file>` 传入一份快照：

```json
{ "dicts": { "<namespace>": ["<key>", "..."] }, "texts": ["<原文>", "..."] }
```

改词条时最常见的翻车方式是「只在一个文件里加了一条」，这个脚本会把它挡在合并之前；
CI 在每次 push / PR 时都会跑一遍。

## 许可

MIT，见 [LICENSE](LICENSE)。
