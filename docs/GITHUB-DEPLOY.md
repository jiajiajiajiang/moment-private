# GitHub Pages 部署与单一主人密码配置

## 安全模型

网站采用“单一主人账户”模式：登录页只显示密码输入框，内部使用配置好的唯一 Supabase 邮箱账户完成认证。邮箱不是认证秘密，真正的秘密是密码。

初始密码按需求设为 `20260907`，但它只应在 Supabase 后台创建账户时输入，绝不能写进 HTML、JavaScript、GitHub 仓库变量或部署文件。GitHub Pages 的前端源码对访问者可见，把密码写进源码等于公开密码。

首次登录后请立即进入“我的 → 修改访问密码”，更换为不少于 10 位的随机密码。建议使用密码管理器生成和保存。

## 一、配置 Supabase

1. 创建 Supabase 项目。
2. 在 Authentication → Sign In / Providers 中启用 Email/Password。
3. 关闭不需要的公开注册方式；此私人部署不要提供注册页面。
4. 在 Authentication → Users 中创建唯一主人账户：
   - Email：使用仅自己控制的邮箱；
   - Password：首次设置为 `20260907`；
   - 确认该账户已验证。
5. 在密码安全设置中提高密码要求、启用泄露密码检查和登录限流。
6. 应用 `database/schema.sql`，确保所有私人业务表启用 RLS。
7. 复制 Project URL 与 Publishable key。不要使用 secret 或 `service_role` key。

## 二、上传 GitHub

把整个项目上传到 GitHub 仓库，主分支使用 `main`。

在 Settings → Secrets and variables → Actions 中添加：

- Repository variable：`SUPABASE_URL`
- Repository secret：`SUPABASE_PUBLISHABLE_KEY`
- Repository secret：`OWNER_EMAIL`

`OWNER_EMAIL` 会进入最终浏览器配置，因此不能被当作真正秘密；使用单独的、不公开用于联络的邮箱可以减少账户标识暴露。密码永远不要加入 GitHub 设置或源码。

## 三、开启 GitHub Pages

1. 进入仓库 Settings → Pages。
2. Source 选择 “GitHub Actions”。
3. 推送到 `main`，或手动运行 “Deploy Moment to GitHub Pages”。
4. 工作流会部署 `prototype/`，并生成不含密码的运行配置。

## 四、首次登录与修改密码

1. 打开 Pages 地址。
2. 输入初始密码 `20260907`。
3. 进入“我的 → 修改访问密码”。
4. 输入当前密码和两次新密码。
5. 修改成功后退出并使用新密码重新登录验证。

## 五、验证隐私隔离

- 浏览器查看源代码时不应出现当前或初始密码；
- Supabase Authentication 中应只有一个主人账户；
- 匿名访问数据库和私有媒体必须失败；
- 退出后刷新页面必须返回登录页；
- 使用错误密码时只显示统一的“密码不正确”，不泄露账户信息；
- 正式保存私人内容前执行 RLS 越权测试。

## 重要限制

密码认证可以保证“不知道密码的人不能登录”，但无法阻止已经解锁的设备被他人使用。请同时为设备设置锁屏密码，不在公共设备保存会话，并在设备遗失时从 Supabase 撤销会话或重置密码。
