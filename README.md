# 找书聚合 (Book Finder)

> 搜一次，多源并发，直链下载。电子书聚合搜索 + 网文下载，纯免费基建（Cloudflare Workers + GitHub Pages），无需服务器。

## 功能

### 电子书模式（9 源并发）
输入书名 → 并发查询 9 个源 → 相关度排序、跨源合并去重 → 直链下载 EPUB/PDF/Kindle/TXT。

| 源 | 语言 | 类型 |
|---|---|---|
| 安娜的档案 | 全 | 大库聚合（人机验证时自动给浏览器入口） |
| 苦瓜书盘 / Sobooks | 中 | 人文社科 / Kindle 精选 |
| 维基文库 | 中 | 公版古籍，可导出 EPUB/PDF |
| Gutenberg (Gutendex) / Standard Ebooks | 英 | 公版，直链下载 |
| Open Library / Internet Archive / Google Books | 英 | 书目大盘 / 公版扫描 / 元数据 |

### 网文下载模式（2 源）
输入网文书名 → 选书 → 选章节范围 → 浏览器内并发抓取 → 打包 **TXT / 标准EPUB** 下载。
- 书源：笔尖中文、梦书中文（规则见 `src/novel/rules.js`，参考社区项目 [so-novel](https://github.com/freeok/so-novel) 的书源配置）
- 架构上 Worker 只做单章代理（缓存 1 天），整书抓取打包在浏览器端完成，规避 Serverless CPU/子请求限制

### 通用能力
- **相关度评分**：直链数×3 + 命中源数×1.5 + 标题相关度（精确 4 / 包含 3 / 部分 ≤2）
- **跨源去重**：书名归一化 + 作者兼容判断双键合并，多源直链聚合到一张卡
- **结果缓存**：Cache API 15 分钟（同词秒开，实测 20s → 54ms）
- **跳转兜底**：没搜到可一键去 11 个书源站搜同词 + 6 个找书导航
- **PWA**：可安装到手机主屏，应用壳离线缓存
- **每日巡检**：GitHub Actions 每日 06:00（北京时间）从墙外对生产 API 做三词冒烟测试 + 网文源断言

## 架构

```
┌─────────────────┐     ┌──────────────────────────┐
│  GitHub Pages    │     │  Cloudflare Worker        │
│  docs/           │────▶│  src/index.js             │
│  PWA 前端        │API │  ├─ /api/search           │──▶ 9 个电子书源
│  (vanilla JS,    │     │  ├─ /api/novel/search     │──▶ 2 个网文源
│   零依赖)        │     │  ├─ /api/novel/toc        │──▶ 网文站
│  章节抓取+EPUB打包│     │  └─ /api/novel/chapter    │
└─────────────────┘     │  Cache API 结果缓存        │
      ▲                  └──────────────────────────┘
      │ GitHub Actions 每日巡检(墙外冒烟测试)
```

```
src/
├── index.js          # 入口 + 路由 + 缓存策略
├── http.js           # fetch 封装(cookie jar/超时/GBK自适应) + Cache API + 工具
├── rank.js           # 相关度评分 + 跨源去重合并
├── ui.js             # Worker 内置极简界面
├── sources/book.js   # 9 个电子书源适配器
└── novel/
    ├── rules.js      # 网文书源规则(选择器/编码/广告过滤)
    └── api.js        # 网文搜索/目录/单章代理(域名白名单防SSRF)
docs/                 # 前端(GitHub Pages 根): index.html + sw.js + PWA 清单/图标
tools/gen-icons.js    # PWA 图标生成脚本
data/book-sources.json# 65 个书源站点调研数据(兜底导航的依据)
```

## 技术选型与理由

| 选择 | 理由 |
|---|---|
| Cloudflare Worker (免费) | 边缘出网不被墙（Open Library/Google Books 国内直连超时，边缘秒回）；免费额度 10 万请求/天；无服务器免运维 |
| GitHub Pages (docs/) | 免费静态托管，与代码同仓，push 即部署 |
| 前端 vanilla JS 单文件 | 页面体量小，零构建零依赖，加载即用；PWA 补齐移动体验 |
| 结果缓存放 Worker (Cache API) | 免费版 CPU 限制 10ms/请求，多源正则解析靠缓存摊薄；同词重复搜索直接命中 |
| 网文打包放浏览器 | Worker 免费版无法承载整书千章抓取；浏览器端 3 并发 + CompressionStream 打包， Worker 只做单章代理（单章结果不可变，缓存 1 天） |
| 网文源规则化 (rules.js) | 借鉴 so-novel 的规则与代码分离思路：源站跑路改规则文件即可，不动核心代码 |
| GitHub Actions 巡检 | 生产 API 在墙内不可达，Actions 是免费的墙外验证通道；每日自动发现失效书源 |

## 部署

```bash
# API (Cloudflare)
npx wrangler login
npx wrangler deploy          # 得到 https://book-finder-api.<子域>.workers.dev

# 前端 (GitHub Pages)
# 仓库 Settings → Pages → Branch: main /docs
# 打开站点，右上角 API 框填入 workers.dev 地址（或改 docs/index.html 里 DEFAULT_API）
```

本地开发：

```bash
npx wrangler dev             # API 调试 http://localhost:8787
cd docs && python -m http.server 8899   # 前端调试, ?api=http://localhost:8787
```

## 实测效果

- **覆盖**：电子书 9 源（中英文出版书、公版、古籍）+ 网文 2 源 + 17 站跳转兜底
- **搜索延迟**：首搜 3~15 秒（9 源并行），同词缓存命中 ~50ms
- **生产健康**：Actions 三词冒烟（pride and prejudice / 三体 / 论语）全源 PASS，网文断言通过
- **去重排序**：实测 12 条原始结果合并为 7 张卡，多源同书聚合直链（Gutenberg + Standard Ebooks 同书 17 个直链合一张卡，评分居首）

## 免责声明

本项目仅聚合公开网页的搜索入口与下载链接，资源版权归原站/作者所有，仅供个人学习消遣，读完觉得好请支持正版。
