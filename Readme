# 片刻 Moment

片刻是一个面向单一主人的私人记忆网页。当前版本采用 **GitHub Pages 静态前端＋Supabase 密码认证、数据库和私有对象存储**，无需独立应用服务器。

网页已从只读原型升级为可实际记录和管理数据的版本。所有私人表均启用 Supabase Row Level Security（RLS），照片存放在私有 Storage Bucket 中，只有登录的主人账户可以访问。

## 当前功能

### 登录与隐私

- 单一主人邮箱＋密码登录；
- 液态玻璃动态登录背景；
- 登录状态持久化、修改密码和退出登录；
- 密码只交给 Supabase Auth 验证，不写入前端或记忆数据库；
- 所有记忆、标签、媒体和个人资料均按登录用户执行 RLS 隔离。

### 记录与媒体

- 新增和编辑文字记忆；
- 一条记忆支持多张图片；
- 事件时间、地点、固定心情、自定义心情和标签；
- 原图直接上传，不在浏览器端重新压缩或转码；
- 图片保持原始画面比例，并限制在视口范围内完整显示；
- 详情页支持切换图片和下载当前原始文件；
- 编辑前的内容自动保存为历史版本。

### 地点

- 内置约 3.4 万座全球城市及多语言别名；
- 支持中文和英文城市搜索；
- 使用随网页部署的 GeoNames 离线城市库和内置世界地图；
- 不依赖 Nominatim、境外地图瓦片或设备定位；
- 城市关键词不会发送给第三方，适用于中国大陆网络环境。

### 浏览与管理

- 首页真实记忆流、照片/地点筛选和随机回忆；
- 时间轴、年份切换和年度统计；
- 按文字、标签、地点和心情搜索；
- 动态照片墙和多图详情；
- 随机回忆屏蔽与恢复；
- 归档、回收站、恢复和二次确认后的永久删除；
- 个人资料编辑和 JSON 数据导出。

### 分享与未来信箱

- 分享面板支持复制摘要、系统分享和 TXT 下载；
- 分享摘要不包含私人图片地址或数据库信息；
- 未来信内容使用 Web Crypto AES-GCM 在浏览器端加密后保存；
- 未来信独立密码不会上传，遗失后无法恢复。

## 项目结构

```text
.
├─ .github/workflows/deploy-pages.yml  GitHub Pages 自动部署
├─ database/
│  ├─ schema.sql                       全新 Supabase 项目初始化结构
│  ├─ interaction-upgrade.sql          既有项目交互功能升级脚本
│  └─ MODEL.md                         数据模型说明
├─ docs/
│  ├─ PRD.md                           产品需求文档
│  ├─ PHASE-1.md                       第一阶段范围
│  └─ GITHUB-DEPLOY.md                 GitHub 与 Supabase 部署说明
├─ prototype/
│  ├─ index.html                       页面结构
│  ├─ app.js                           认证、数据与交互逻辑
│  ├─ styles.css                       响应式样式
│  ├─ config.example.js                本地配置示例
│  └─ assets/
│     ├─ cities15000.min.json          GeoNames 离线城市库
│     └─ GEONAMES-LICENSE.txt          城市数据来源与许可
└─ moment-github-deploy.zip            可上传部署包
```

## 从零部署

### 1. 创建 Supabase 项目

1. 在 Supabase 创建项目。
2. 打开 **Authentication → Users**，创建唯一主人邮箱账户并设置密码。
3. 打开 **SQL Editor**，执行 [`database/schema.sql`](database/schema.sql)。
4. 确认已创建私人存储桶 `memory-media`，并且相关表已启用 RLS。

如果数据库已经执行过早期版本的 `schema.sql`，不要重新初始化；只运行 [`database/interaction-upgrade.sql`](database/interaction-upgrade.sql)。该脚本保留已有数据，并修复编辑、归档和历史版本写入所需的权限。

### 2. 配置 GitHub 仓库

在仓库 **Settings → Secrets and variables → Actions** 中配置：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Repository variable | `SUPABASE_URL` | Supabase Project URL，例如 `https://项目编号.supabase.co`，末尾不要添加 `/rest/v1/` |
| Repository secret | `SUPABASE_PUBLISHABLE_KEY` | Supabase Publishable key，以 `sb_publishable_` 开头 |
| Repository secret | `OWNER_EMAIL` | 唯一主人账户邮箱 |

不要将 Supabase Secret key、`service_role` key 或主人密码放入 GitHub Pages、`config.js` 或仓库文件。

### 3. 启用 GitHub Pages

1. 上传本仓库文件，保持目录结构不变。
2. 打开 **Settings → Pages**。
3. 将 Source 设置为 **GitHub Actions**。
4. 推送到 `main`，或在 Actions 中手动运行 `Deploy Moment to GitHub Pages`。
5. 等待工作流变为绿色，然后访问：

```text
https://<GitHub用户名>.github.io/<仓库名>/
```

部署工作流会根据 GitHub 配置动态生成 `prototype/config.js`，随后只发布 `prototype/` 目录。

## 更新现有网站

1. 下载并解压最新的 `moment-github-deploy.zip`。
2. 覆盖 GitHub 仓库中的对应文件，保持 `.github`、`database` 和 `prototype` 目录结构。
3. 提交到 `main`。
4. 等待 GitHub Actions 部署成功。
5. 浏览器按 `Ctrl+F5` 强制刷新，避免继续使用旧的脚本和样式缓存。

仅更新页面样式、图片展示、分享面板或离线城市库时，一般不需要再次运行数据库脚本。只有升级说明明确指出数据库结构或策略变化时，才需要执行对应 SQL。

## 本地查看与验证

不要直接双击 `index.html` 测试完整功能。本地城市库、认证和浏览器安全能力需要通过 HTTP(S) 访问。

可以在 `prototype/` 目录启动任意静态文件服务器，然后访问其本地地址。真实数据功能还需要在 `config.js` 中填写 Supabase Project URL、Publishable key 和主人邮箱；不要填写 Secret key 或密码。

页面验证脚本位于 `prototype/check-prototype.cjs`，用于检查主要页面、响应式布局、城市搜索和浏览器脚本错误。

## 数据与安全说明

- GitHub Pages 上的 HTML、CSS、JavaScript、Publishable key 和离线城市库都是公开资源；
- Publishable key 本来就用于浏览器，真正的数据保护依赖 Supabase Auth 与 RLS；
- `memory-media` 必须保持私有，页面通过登录会话和短时签名链接读取图片；
- 原图下载同样需要已登录用户通过 Storage RLS；
- JSON 导出包含文字、标签和媒体清单，不等同于完整原图备份；
- 系统分享的可用目标由操作系统和已安装应用决定，复制摘要是最稳定的跨平台方式；
- 离线城市数据来自 [GeoNames](https://www.geonames.org/)，遵循 Creative Commons Attribution 4.0，详情见 `prototype/assets/GEONAMES-LICENSE.txt`。

## 当前边界

- 临时公开分享链接和精细访问权限尚未接入 Supabase Edge Function，目前使用不会暴露图片地址的摘要分享；
- 视频自动转码、AI 语义搜索、完整原图批量导出、自动云端备份和服务端年度总结仍属于后续阶段；
- GitHub Pages 是公开静态托管，仓库是否私有不等于网页访问受限，访问控制必须依靠 Supabase 登录和 RLS。
