# 公众号 AppID / AppSecret 获取指引

> 本文件供 Agent 在用户缺少凭据时读取，据以下步骤指导用户获取 AppID / AppSecret，并写入 `accounts.json`。

## 前置

- 该工具统一走 direct 官方 API 模式，不依赖 relay 中转。
- 应将运行 `wx-mp-publisher` 的机器在请求微信 API 时的实际公网出口 IP 加入白名单。VPN、公司代理、移动网络或 NAT 切换都可能改变该 IP。
- 用户需有公众号管理员微信号

## 获取步骤

1. 打开 [https://developers.weixin.qq.com/platform](https://developers.weixin.qq.com/platform)
2. 用**与公众号同一管理员**的微信号扫码登录
3. 首页下方「我的业务」中点「公众号」
4. 选择要授权 Agent 推送文章的公众号
5. 在该页能看到 **AppID**，复制后发给 Agent
6. 同一页面「开发秘钥」中：
   1. 先编辑「API IP 白名单」：填入运行机的实际公网出口 IPv4（建议在**启用目标 VPN/代理的同一终端会话**中查询一个 HTTPS IP 回显服务，或向网络管理员确认 NAT 出口；若出口动态，不建议直接发布）。
   2. 点 **AppSecret** —— 注意 **AppSecret 只显示一次**，复制好发给 Agent
   3. Agent 确认收到后再点关闭
   4. 若操作失误，可点「重置」重新生成

## 写入 accounts.json

Agent 收到 AppID + AppSecret 后，写入 `~/.openclaw/wx-mp-publisher/accounts.json`（源仓之外的实例态目录，密钥不落源仓）：

```json
{
  "default": "main",
  "accounts": [
    { "alias": "main", "appId": "wx...", "appSecret": "..." }
  ]
}
```

- 多账号：在 `accounts` 数组里多加一条，每条取一个易沟通的 `alias`（如 `main` / `tech` / `brand`）
- 多账号时 `default` 必填，指向默认使用的 alias
- 单账号 `default` 可留空字符串 `""`（脚本会自动用唯一账号）

## Direct 模式使用与验证

先在工具目录安装锁定依赖（不会配置任何凭据）：

```bash
cd <wx-mp-publisher 工具目录>
npm ci --omit=dev
```

先做无网络预演：

```bash
wx-mp-publisher /absolute/path/article.md --transport direct --dry-run
```

排查已有草稿覆盖时官方 API 返回的 `47001`，可在真实 direct 更新命令加 `--debug-schema`。它只输出提交 payload 的字段名、类型、字节长度和 SHA-256，绝不输出正文、media ID、token 或 AppSecret。该开关不改变创建/更新行为，若不希望发生请求请一并传 `--dry-run`：

```bash
wx-mp-publisher /absolute/path/article.md --transport direct --update-media-id <media_id> --debug-schema --dry-run
```

预演成功且用户已明确提供 AppID/AppSecret、白名单已稳定后，才可创建草稿：

```bash
wx-mp-publisher /absolute/path/article.md --transport direct
```

Direct 模式只调用 token、图片、永久封面素材与 `/cgi-bin/draft/add`；传入 `--update-media-id` 时改为调用 `/cgi-bin/draft/update`，不会回退或新增草稿。新增请求的 `articles` 是数组，而更新请求的 `articles` 必须是单个对象，并同时传 `media_id` 与 `index`。更新可重新上传正文图片 URL 和永久封面素材 ID；`newspic` 的 `content` 按官方约束降为纯文本，不能复用普通图文的 HTML 正文，否则会触发 45166 `invalid content`；从不调用正式群发。令牌缓存为 `~/.openclaw/wx-mp-publisher/token-cache.json`，以 0600 权限原子更新，日志中会脱敏 AppSecret/access_token。

## 安全

- `accounts.json` 在源仓之外（`~/.openclaw/wx-mp-publisher/`），不会进 git / tarball / 备份
- AppSecret 等同于密码，不要贴到聊天群 / issue / 日志里
