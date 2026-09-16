---
name: wx-mp-publisher
description: 将 Markdown 排版推送到微信公众号草稿箱；统一使用官方 direct 模式与本地 dry-run。
---

# wx-mp-publisher — 工具说明

> 本文是 `expert-wx-mp` 专家包内的工具说明书，不独立出现在技能列表中。由相关 Workflow 指引调用。

将 Markdown 稿件排版并推送到微信公众号草稿箱，统一走官方 direct 模式。

---

## 凭据与存储位置

- **公众号凭据**存放在源仓之外的实例态目录（不跟源仓绑，软链 / tarball / 备份都不带密钥）：
  ```
  ~/.openclaw/wx-mp-publisher/accounts.json
  ```
  结构见本 skill 同目录 `accounts.example.json`。支持多账号，每条含 `alias` / `appId` / `appSecret`；多账号时 `default` 指向默认 alias。

### 凭据缺失时 Agent 行为

1. 若 `accounts.json` 不存在或对应账号缺 `appId`/`appSecret`：**先读同目录 `REFERENCE.md`**，按其中的步骤指导用户获取 AppID / AppSecret。
2. 收到用户提供的值后，写入 `accounts.json`，再继续发布。

---

## 发布命令

通过 PATH 调用 wrapper：`wx-mp-publisher <cmd>`，无需手动拼接 python 命令或脚本路径。

```bash
# 官方 API direct：只创建草稿，绝不群发
wx-mp-publisher <markdown_file> [theme] [--account ALIAS]

# 官方 API direct：覆盖已有草稿第 0 篇文章（替换封面和正文图；绝不群发）
wx-mp-publisher <markdown_file> frontier-editorial-blue --transport direct --account ALIAS --update-media-id <media_id>

# 仅 direct：排查 draft/update 的 47001；输出脱敏 schema，仍会按实际命令创建/更新草稿
wx-mp-publisher <markdown_file> frontier-editorial-blue --transport direct --account ALIAS --update-media-id <media_id> --debug-schema

# 本地渲染/校验；不读取凭据、不发起网络请求
wx-mp-publisher <markdown_file> --transport direct --dry-run

# 覆盖预演：输出脱敏计划，不读凭据、不发起网络请求
wx-mp-publisher <markdown_file> frontier-editorial-blue --transport direct --update-media-id <media_id> --dry-run
```

- `theme`：渲染主题，二种形态：
  1. **内置 id**（`pie` / `lapis` / `default` / …）——按本地主题注册表解析，最终传给 direct 渲染器
  2. **本地 `.css` 文件路径**或 `wenyan-theme/index.json` 登记的自定义 id——脚本读取 CSS 内容并在 direct 模式下随请求提交

  可选，缺省时 direct 渲染器按内置主题或默认样式处理。
- `--account ALIAS`：多账号时指定目标公众号；缺省用 `accounts.json` 的 `default`
- `--transport direct`：官方 API direct 模式，默认即为 direct，不再走中转层。
- `--dry-run`：预演并验证本地渲染，不发起外部请求（direct 不读取账号/令牌）。
- `--update-media-id <media_id>`：通过官方 `/cgi-bin/draft/update` 覆盖该草稿的 `index: 0` 文章；先重新上传正文图片和封面永久素材，再以新素材替换。dry-run 输出的 media_id 会脱敏；实际成功输出保留完整 ID 便于核对。
- `image_list` 使用官方 `article_type: newspic`。微信对图片消息的 `content` 仅接受纯文本（及少数特殊标签），不接受普通图文的 HTML；工具会把本地渲染出的正文 HTML 降为纯文本后再提交，避免 API 45166 `invalid content`。
- `--debug-schema`：用于诊断官方 `draft/update` 的 `47001`。请求提交前输出 payload 的字段名、类型、字节长度及 SHA-256；不输出正文、media ID、access token、AppSecret 或其他值。该开关不改变创建/更新行为，配合 `--dry-run` 时不产生请求。

> 主题注册表在 client 侧：**工作区 `wenyan-theme/index.json`**。generate-wenyan-theme 生成新主题后写入该文件，发布时从该文件读取。结构固定为 `version: 1` + `themes` 数组；每条记录包含 `id`、`name`、`css`、`source`、`createdAt`。

脚本自动：
- 从 `accounts.json` 取目标账号凭据
- 自动收集正文、`cover`、`image_list` 中的本地图片并随稿件一起上传
- 发布前校验图片引用和 frontmatter `author`；校验失败会直接退出
- 直接调用微信官方 API 草稿箱接口
- 校验响应包络 `{ success, data, error }`

### 主题选择（未指定时）

> 自定义主题说明：`generate-wenyan-theme` 生成的用户自定义 CSS 登记在 `wenyan-theme/index.json`。若用户明确指定某个自定义主题，必须优先采用；未指定时才按内容在内置主题和已登记自定义主题中匹配。

| 主题 ID | 风格描述 | 适用场景 |
|---------|---------|---------|
| `default` | 简洁经典 | 资讯、通知、简讯 |
| `pie` | 现代锐利（仿少数派） | 深度长文、评测、观点（默认） |
| `lapis` | 极简冷蓝 | 技术教程、代码分析 |
| `purple` | 简约紫调 | 品牌、商务、精品内容 |
| `orangeheart` | 暖橙优雅 | 情感、故事、节日 |
| `maize` | 淡雅玉米黄 | 健康生活、美食、户外 |
| `rainbow` | 多彩活泼 | 亲子、宠物、娱乐 |
| `phycat` | 薄荷清爽 | 科普、知识型内容 |

**智能选择决策树**（用户未指定主题时）：

```
含大量代码/技术术语 → lapis
年轻女性/亲子/萌宠  → rainbow
情感/故事/节日      → orangeheart
健康/美食/户外      → maize
品牌/商务/精品      → purple
科普/知识型         → phycat
深度长文/评测/观点  → pie
其他（资讯/通知）   → default
```

---

## Frontmatter 要求

文章 Markdown 开头必须包含 YAML 块，否则微信 API 会拒绝：

```yaml
---
title: 文章标题
cover: cover.jpg             # 可选，缺省自动取正文第一张图
author: 作者名称              # 可选，≤ 8 个汉字 / 24 字节（超长报 45110）
source_url: https://...      # 可选，原文链接
need_open_comment: true      # 可选，是否开启评论（默认 false）
only_fans_can_comment: false # 可选，是否仅粉丝可评论（默认 false）
---
```

### 小绿书（图片消息）

纯图片轮播形式，不含正文 HTML。在 frontmatter 中指定 `image_list`（最多 20 张，首张为封面）：

```yaml
---
title: 文章标题
image_list:
  - 1.jpg
  - 2.jpg
---
```

有 `image_list` 时 direct 走图片消息接口，忽略主题参数。

### 本地图片准备规则

发布前把本地图片复制到 Markdown 同目录，并按以下规则引用：

1. 正文图片写 `![说明](filename.jpg)`
2. `cover` 写 `cover: cover.jpg`
3. `image_list` 写 `- 1.jpg`
4. 只写纯文件名；不要写 `./filename.jpg`、目录路径或绝对路径
5. 所有本地图片文件名必须唯一；重名时先重命名再更新 Markdown
6. `http://` / `https://` 图片保留原 URL，不需要复制到本地

Agent 不需要手动上传图片；脚本会自动收集并上传上述本地图片。

---

## 官方 API direct 模式

`direct` 只实现草稿链路：新建为 `/cgi-bin/token` → 正文图片 `/cgi-bin/media/uploadimg` → 封面永久素材 `/cgi-bin/material/add_material` → `/cgi-bin/draft/add`；显式 `--update-media-id` 则使用同一上传链路后调用 `/cgi-bin/draft/update`，请求体为 `{media_id, index: 0, articles: article}`（注意：新增接口的 `articles` 是数组，更新接口是单个对象）。`draft/update` 允许用新的永久 `thumb_media_id` 替换封面，也允许将正文图片重传至 `/media/uploadimg` 后将返回 URL 写入 `content`；不会新建草稿。可加 `--debug-schema` 在实际 `draft/update` 请求前输出字段名、类型、字节长度和 SHA-256，不输出正文、media ID、access token、AppSecret 或其他值。**代码和工作流均不得调用 `/freepublish/submit` 或任何群发接口。**

- 账号仍只读实例态 `~/.openclaw/wx-mp-publisher/accounts.json`；token 缓存为同目录 `token-cache.json`，原子写入、权限 `0600`、提前 5 分钟刷新。
- 渲染使用锁定的 `@wenyan-md/core@3.0.11` + `jsdom@27.4.0`，以 `frontier-editorial-blue.css` 内联样式；输出清除 `<script>`/`<style>`，不保留本地图片路径。
- `frontmatter` 必须有 `title` 和 `cover`；支持 `need_open_comment`/`only_fans_can_comment`；`author` 可省略。
- 直接模式的正文和 cover 均只接受与 Markdown 同目录的**纯文件名**。正文图片上传后替换为微信 URL，cover 上传为永久素材并写入 `thumb_media_id`。
- 新增 npm 依赖仅在本工具目录的 `package.json`/`package-lock.json` 锁定；首次部署须在该目录执行 `npm ci --omit=dev`。不在运行时自动安装依赖。

## Agent 行为约束

1. **等待脚本完整返回后**再判定结果，**禁止**在脚本输出前自行判断是否发布成功
2. 发布前先确认目标账号凭据存在；缺失则按 `REFERENCE.md` 引导用户获取并写入
3. 多账号场景：用户未明示账号时用 `default`；用户口头说「发到技术号」等 alias 含义时传 `--account`

---

## Error Handling

| 错误 | 处理方式 |
|------|---------|
| `未找到公众号凭据文件 accounts.json` | 按 `REFERENCE.md` 引导用户创建并填入 |
| `账号 ... 缺少 appId 或 appSecret` | 按 `REFERENCE.md` 引导用户补全 |
| `45110: author size out of limit` | frontmatter `author` 超 8 汉字 / 24 字节，缩短后再发 |
| 图片 `ENOENT` | 将对应图片复制到 Markdown 同目录，改为纯文件名引用，并确认文件存在、文件名唯一 |
| direct 40164 | 本机当前**实际公网出口 IP**未加到公众号 API 白名单；VPN/代理切换后重新判定（见 `REFERENCE.md`） |
| direct 40013 / 40125 | 分别核对 AppID / AppSecret；日志已脱敏，不要将 Secret 粘贴进群聊 |
| direct 素材或草稿错误 | 检查封面/正文格式、大小与微信素材限制；脚本会输出脱敏的微信错误码提示 |

---

## Notes

- 发布成功后输出草稿 `media_id`，可在公众号后台「草稿箱」找到对应草稿
- 本 skill 只负责推送草稿，**正式发布仍需在公众号后台手动操作**
- 直接调用微信官方 API，不再依赖中转服务
- 仅支持文本 + 图片（无视频）

## 微信平台硬限制（发布链路通用）

- 标题长度：最多 64 字节（约 21 个中文字符）
- 本地图片：与 Markdown 放同目录，用唯一纯文件名引用；脚本会自动上传
- 样式：必须内联（`style="..."`），`<style>` 标签会被过滤
- access_token 有效期 2 小时，客户端需要按官方 token 规范刷新
