# 片刻 Moment

本工作区包含片刻的产品与第一阶段开发基线：

- `docs/PRD.md`：完整产品需求文档；
- `docs/PHASE-1.md`：第一阶段工程范围和完成标准；
- `database/schema.sql`：Supabase/PostgreSQL 数据库结构与 RLS；
- `database/MODEL.md`：数据库关系和关键设计决策；
- `prototype/index.html`：响应式可点击页面原型。
- `.github/workflows/deploy-pages.yml`：GitHub Pages 自动部署工作流。
- `docs/GITHUB-DEPLOY.md`：Supabase 单一主人密码认证与 GitHub 部署说明。

## 查看页面原型

直接使用浏览器打开 `prototype/index.html` 可查看界面；默认配置不会连接后端。填写 Supabase 配置后，手机号发送与验证码校验会连接真实认证服务，其余记忆内容仍为演示数据。

若需要真实密码登录，请按 `docs/GITHUB-DEPLOY.md` 创建唯一主人账户，并配置 Supabase Email/Password Auth 与 GitHub 仓库变量。密码不得写入前端源码。

## 进入第一阶段开发前

1. 创建 Supabase 项目并记录开发环境变量；
2. 确认存储配额和回收站保留期限；
3. 将 `database/schema.sql` 拆成正式迁移并执行 RLS 越权测试；
4. 按 `docs/PHASE-1.md` 初始化 Next.js 应用。
