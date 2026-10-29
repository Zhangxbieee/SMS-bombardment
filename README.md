# SMS 短信压力测试系统

一个基于 Cloudflare Pages 的短信测压工具，仅用于学习交流目的。

## ⚠️ 免责声明

本程序仅用于短信测压和学习交流，请勿用于非法用途。使用本程序造成的一切后果由使用
者自行承担。请只对你本人拥有、或已获得书面授权的号码进行测试。

---

## 📣 快速部署（新开发者必读）

### 前置条件

- 一个 [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费）
- 一个 [GitHub 账号](https://github.com/)（免费）

### 第一步：Fork 仓库

1. 点击本仓库右上角的 **Fork** 按钮
2. 将仓库 Fork 到你自己的 GitHub 账号下

### 第二步：创建 Cloudflare Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单选择 **Workers 和 Pages**
3. 点击 **创建** → **Pages** → **连接到 Git**
4. 授权 GitHub 并选择你 Fork 的仓库
5. 配置构建设置：

   | 设置项       | 值                             |
   | ------------ | ------------------------------ |
   | 项目名称     | `zhangxbieee-sms-bombardment` |
   | 生产分支     | `main`                         |
   | 构建命令     | 留空                           |
   | 构建输出目录 | `public`                       |

6. 点击 **保存并部署**

### 第三步：等待部署完成

首次部署约需 1-2 分钟。部署成功后会获得一个域名：`https://你的项目名.pages.dev`

### ✅ 完成！

无需额外配置 proxy 或 Workers，**Cloudflare Pages 会自动处理 `functions/` 目录下
的代理函数**。访问地址：https://zhangxbieee-sms-bombardment.pages.dev

---

## 📦 项目结构

```
├── public/               # ← 静态资源目录（Pages 的「构建输出目录」）
│   ├── index.html        #   主页面（前端代码 + 154 个接口定义）
│   ├── _headers          #   CDN 缓存策略配置
│   ├── logo.ico          #   网站图标
│   └── logo.gif          #   页面 Logo
├── functions/
│   └── [[path]].js       # CORS 代理函数（自动部署为 Cloudflare Pages Functions）
├── test/                 # 单元测试（npm test）
├── wrangler.json         # Wrangler 配置（pages_build_output_dir = public）
├── package.json          # npm 脚本
└── README.md             # 项目说明
```

> 静态资源单独放在 `public/` 是有意为之：这样部署到线上的只有 `index.html`、
> 图标和 `_headers`，**源码、`.git` 目录、配置文件都不会被公开**。

---

## 🎮 使用方法

1. 打开部署后的网站
2. 输入目标手机号（11 位中国大陆手机号）
3. 按需调整参数：

   | 参数         | 默认值 | 说明                                           |
   | ------------ | ------ | ---------------------------------------------- |
   | 并发数       | 5      | 同时在途的请求数，上限 30                       |
   | 每接口重复   | 1      | 每个接口重复调用的次数，上限 10                 |
   | 间隔 (ms)    | 200    | 每轮并发跑满后的等待时间，避免把目标接口打爆    |
   | 授权确认     | 未勾选 | 勾选后才能发起测试                             |

4. 勾选授权确认，点击「📣 开始发送」
5. 查看实时日志输出，点击「⏹️ 停止发送」可随时中断

> 单次点击 = `154 个接口 × 每接口重复次数` 个请求，跑完即停，**没有无限循环**。

---

## 📊 结果判定说明（重要）

很多接口会返回 HTTP 200 但业务其实失败了，例如
`{"code": 500, "msg": "发送过于频繁"}`，或者干脆返回一个 HTML 错误页。
本工具会解析响应体，把每次请求归入三态：

| 状态         | 含义                                       | 判定依据                             |
| ------------ | ------------------------------------------ | ------------------------------------ |
| ✅ **已触发** | 接口明确表示请求已被受理                   | `code` 为成功值 / `success=true` / 提示语含成功标识 |
| ❓ **未确认** | HTTP 2xx，但响应里没有可识别的业务信号     | 返回了 HTML 页面或无任何业务字段     |
| ❌ **失败**   | 接口明确表示失败，或 HTTP 状态码非 2xx     | `code` 为失败值 / `success=false` / 4xx、5xx |

**只有「已触发」才代表接口侧确认受理了请求。** 「未确认」无法据此判断短信是否真的
发出，最终以手机是否收到为准。

---

## 🔐 安全设计

部署后 `functions/[[path]].js` 就是一台**公开的开放代理**，任何人拿到你的域名都能
转发请求。因此函数内置了以下防护，避免你的 Cloudflare 账号被判定为滥用：

- **仅允许 `http` / `https` 协议**
- **阻断内网地址**：`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、
  `100.64.0.0/10`、`169.254.0.0/16`（含云厂商元数据 `169.254.169.254`）、
  IPv6 回环 / 唯一本地地址 / 链路本地地址
- **阻断内网域名**：`localhost`、`*.localhost`、`*.internal`、`*.local`、
  `metadata.google.internal` 等
- **重定向逐跳校验**：手动跟随重定向，每一跳都重新校验目标，最多 3 跳
- **不转发 `host` / `origin` / `referer` / `cookie`**：`host` 由运行时设置；
  伪造 `referer` / `origin` 等于帮请求伪装来源，公开代理这么做会很快被目标站风控识别

> ⚠️ 即便有上述防护，你的 Pages 项目仍是公开的。**不要在同一个 Pages 项目里放其他
> 业务**，建议为这个工具单独建一个项目。

---

## 🛠️ 开发与维护

### 本地开发

```bash
# 1. 克隆仓库
git clone https://github.com/<你的用户名>/SMS-bombardment.git
cd SMS-bombardment

# 2. 安装 Wrangler CLI
npm install -g wrangler

# 3. 登录 Cloudflare
wrangler login

# 4. 本地预览（会启动本地服务器）
wrangler pages dev
```

也可以用 npm 脚本：

```bash
npm test     # 跑结果判定逻辑的单元测试（19 条用例）
npm run dev  # 等价于 wrangler pages dev
```

### 提交代码

```bash
git add .
git commit -m "feat: 你的修改描述"
git push origin main
```

> ⚠️ **重要**：Cloudflare Pages 只监听 `main` 分支，推送到其他分支不会触发部署。

### 手动部署

如果自动部署未生效，可手动部署：

```bash
npx wrangler pages deploy --project-name 你的项目名 --branch main
```

静态资源目录由 `wrangler.json` 里的 `pages_build_output_dir` 指定（`public`），
不需要再额外传目录参数。

### 清除 CDN 缓存

如果部署后页面未更新：

1. 进入 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 选择你的域名 → **Caching** → **Configuration**
3. 点击 **Purge Everything**

---

## 🔧 常见问题

### Q: 需要单独创建 Workers 或 proxy 吗？

**不需要。** Cloudflare Pages 会自动将 `functions/` 目录下的文件部署为
Functions（类似于 Workers）。

### Q: 为什么日志里大量是「未确认」？

说明请求成功送达了目标接口，但对方既没返回业务码，也没返回明确的提示语——通常是
返回了一个 HTML 页面。这类接口无法据此判断短信是否真的发出。

### Q: 为什么接口报 403 / 接口拒绝？

这些接口大多会校验 `Referer` 来源（微信小程序 `servicewechat.com` 系、政务系统等）。
浏览器不允许 JS 设置 `Referer`，代理也会把它剥掉，所以这类请求拿不到伪造的来源。
这是有意为之的安全默认。

### Q: 免费额度是多少？

- **Cloudflare Pages**：无限请求
- **Cloudflare Functions**：每天 10 万次免费请求

### Q: 超过额度会怎样？

超过 10 万次后，代理请求会失败，页面会显示"连续失败 XX 次，已自动停止"。等待次日
额度重置即可。

---

## 🤖 功能特性

- ✅ 支持多个短信接口同时发送
- ✅ 并发数 / 重复次数 / 请求间隔可配置
- ✅ 实时日志显示发送状态
- ✅ 结果三态判定（已触发 / 未确认 / 失败），不再把 HTTP 200 一律当成功
- ✅ 连续失败自动停止（保护代理额度）
- ✅ 按钮状态颜色区分（绿色开始/红色停止）
- ✅ 失败原因准确显示
- ✅ 现代化 UI 界面
- ✅ CORS 代理支持，附带 SSRF 防护
- ✅ 响应式设计

---

## 📄 许可证

本项目仅供学习研究使用，请勿用于商业用途或非法活动。
