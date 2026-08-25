# 数据库模型说明

## 核心关系

```text
auth.users 1──1 profiles
auth.users 1──N memories 1──N media_assets
                      ├──N memory_versions
                      ├──N memory_tags N──1 tags
                      ├──1 memory_embeddings
                      ├──N recall_events
                      └──N memory_shares

auth.users 1──N future_letters
auth.users 1──N annual_reviews
auth.users 1──N export_jobs
```

主人邮箱和密码属于认证凭据，统一由 `auth.users` 管理。业务侧 `profiles` 不重复保存邮箱或密码；密码只以认证系统生成的哈希存在，避免敏感凭据扩散到业务数据域。

## 关键设计决策

### 双时间

`memories.event_at` 表示事情发生的时间，是首页、时间轴和年度总结的主要排序依据；`created_at` 表示记录进入系统的时间，用于审计和产品分析。`event_timezone` 保存用户当时采用的时区语境。

### 一条记忆、多份媒体

媒体独立放在 `media_assets`，通过 `memory_id` 关联。`sort_order` 保存手动顺序；首次写入时由服务端根据 EXIF 时间生成默认顺序。

### 原图、展示图、缩略图

数据库只保存私有对象键：

- `original_object_key`：原文件；
- `display_object_key`：网页浏览用压缩版本；
- `thumbnail_object_key`：列表和日历使用。

前端不得保存或缓存永久公共 URL，应按需获取短期签名地址。

### 修改历史

`memory_versions` 保存修改前的结构化快照。媒体文件本身不复制，快照中的对象关系用于审计；如需完整恢复媒体排序和标签关系，应用服务应在同一事务中把这些关系写入快照扩展字段。

### 软删除与归档

`status` 区分 `active`、`archived` 和 `trashed`。进入回收站只改变状态和 `trashed_at`；定时清理任务在保留期结束后删除记录，并回收没有引用的对象。

### AI 搜索

`memory_embeddings` 独立保存向量及其来源哈希。任何向量查询都必须先限定 `user_id`，且该表启用 RLS。用户关闭 AI 搜索时应删除对应索引，而不是只隐藏入口。

### 临时分享

数据库只保存分享令牌哈希，原始令牌只在创建时返回一次。公开访问必须经服务端函数验证：令牌、到期时间、撤销状态、密码和具体授权范围；不得直接为该表增加匿名读取策略。

### 未来信箱

正文使用应用层密钥加密后写入 `content_ciphertext`。未到开启时间的查询接口不得返回解密内容。

## 第一阶段实际使用的表

- `profiles`
- `memories`
- `memory_versions`
- `media_assets`
- `tags`
- `memory_tags`

其余表用于后续阶段的兼容性预留。上线前仍应将迁移按阶段拆分，并为 RLS 编写用户 A／用户 B 越权测试。
