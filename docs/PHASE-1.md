# 第一阶段开发基线

## 建议技术栈

- 前端与服务端渲染：Next.js（App Router）+ TypeScript；
- 样式：Tailwind CSS；
- 认证、数据库和对象存储：Supabase；
- 图片处理：异步 Worker 或 Supabase Edge Function 调用专用图片处理服务；
- 部署：支持 Node.js 的托管平台；
- 监控：不采集私人正文和媒体 URL 的错误监控。

## 推荐工程模块

```text
app/
  (auth)/         登录、注册、找回密码
  (private)/      受保护页面
    page          首页记忆流
    memories/new  创建记忆
    memories/[id] 记忆详情
    trash          回收站
components/
  memory/         记忆卡片、媒体网格、表单
  navigation/     顶部和底部导航
lib/
  auth/           会话和路由保护
  db/             查询与数据映射
  media/          上传、排序、状态轮询
  validation/     输入校验
supabase/
  migrations/     数据库迁移
```

## 开发顺序

1. 创建 Supabase 项目和唯一主人账户、应用迁移、验证 RLS；
2. 完成密码登录、密码修改、认证限流、会话管理和私人路由；
3. 完成私有媒体直传、上传状态和数据库登记；
4. 完成创建记忆事务与媒体排序；
5. 完成首页记忆流和详情页；
6. 完成修改历史、软删除、回收站恢复；
7. 完成响应式、无障碍、安全和端到端测试。

## Definition of Done

- 功能满足 PRD 验收标准；
- 查询全部受用户身份和 RLS 双重保护；
- 有加载、空、错误、重试状态；
- 手机宽度 360px 起可正常使用；
- 新增数据库变更有迁移和回滚说明；
- 核心业务有自动化测试；
- 不在日志中暴露私人内容。
