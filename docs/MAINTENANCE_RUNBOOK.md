# 小说共读维护手册

> 公开稳定标签：`v0.3.34`

这份手册用于以后更新、部署和排错。它不包含任何私密 MCP 路径、token、书籍正文或阅读记录。

## 1. 开始修改前

```bash
git status --short
git branch --show-current
git log -5 --oneline --decorate
git tag --sort=-creatordate | head
```

确认：

- 当前分支和稳定标签。
- 工作区是否有未提交修改。
- D1、R2 和已有书籍不在本次修改范围内。
- 目标环境是 Web、iPhone、iPad 中的哪些行。

## 2. 本地检查

项目声明 pnpm 版本，优先使用 Corepack：

```bash
corepack pnpm@10.15.1 test
corepack pnpm@10.15.1 typecheck
corepack pnpm@10.15.1 build
```

只改一个窄模块时可以先跑聚焦测试，但准备打稳定标签前应运行完整检查。

## 3. 部署

```bash
corepack pnpm@10.15.1 --filter @ss/server run deploy
```

记录 Wrangler 返回的 Worker Version ID。不要把私密 MCP path 写进提交、截图或文档。

## 4. 部署后协议检查

依次确认：

1. `/health` 返回预期应用版本。
2. MCP `initialize` 返回成功。
3. `tools/list` 包含预期工具。
4. `open_reading_nest` 指向预期 UI resource URI。
5. `resources/read` 返回 `text/html;profile=mcp-app`。
6. `read_shared_page_context` 能读取当前页和当前页想法，但没有 UI 绑定。
7. 连续请求几次，结果一致后再开始真实设备验收。

## 5. 三端验收表

| 环境 | 打开阅读器 | 显示多书书架 | 打开详情 | 翻页保存 | 共读想法 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| ChatGPT Web | | | | | | |
| iPhone ChatGPT | | | | | | |
| iPad ChatGPT | | | | | | |

验收规则：

- Web 成功不能替代 iPhone。
- iPhone 成功不能替代 iPad。
- 工具文字返回不能替代 UI 挂载。
- 灰色块属于宿主挂载症状，不能直接推断书籍丢失。

## 6. 常见问题速查

### 书架显示 0 本，但模型能说出书名

检查顺序：

1. `open_reading_nest` 的 `_meta.privateBookshelf`。
2. 组件的初始 host output 合并。
3. `get_novel_bookshelf` 的 app-only 刷新结果。
4. 后来的 null 字段是否覆盖了有效 `sourceEndpointBase`。

### 本机提示缓存丢失

这不等于书籍删除。检查：

- D1 是否仍有 session 和 source manifest。
- R2 正文是否可用。
- 组件是否能按 manifest 恢复并重建 IndexedDB。

### iPhone 出现灰色组件块

先分层确认工具和资源是否正常。如果协议均正常，则记录为宿主挂载未完成，不要反复改书架或存储逻辑。

重点比较：

- 当前与稳定标签的 resource URI。
- descriptor `_meta.ui.resourceUri`。
- result `_meta` 的兼容字段。
- 边缘部署是否已稳定传播。
- 新对话和重新连接是否真的读取了新工具列表。

### 共读回复像复读机

确认组件只发送简短意图，不把 `【这一页正文】` 拼进可见消息。模型应调用 `read_shared_page_context`，并遵守“不复述整页、不逐条转抄想法”的策略。

### 想法在组件里存在，但模型读不到

分别验证：

1. 想法是否已经写入 D1。
2. 想法的 `sessionId` 和位置是否匹配当前页。
3. `read_shared_page_context` 返回的 `savedThoughts` 数量。
4. 模型是否真正调用了这个工具，而不是只根据书架摘要回答。

## 7. 回退原则

回退前先保留当前状态：

```bash
git status --short
git diff --check
git log -3 --oneline --decorate
```

不要使用 `git reset --hard`。需要比较稳定版本时，创建单独分支或工作副本，再从稳定标签部署候选。

已确认稳定点：

- `v0.3.34`

私有开发历史中的旧标签没有随干净开源快照发布。公开仓库从 `v0.3.34` 开始建立独立历史。

## 8. 发布一个新稳定版本

完成以下条件后再提交和打标签：

- 自动测试和生产构建通过。
- 线上版本与资源 URI 已记录。
- Web、iPhone、iPad 的承诺范围分别验收。
- 多书、阅读位置和想法仍存在。
- 没有提交 secrets、正文或个人阅读数据。

然后执行：

```bash
git add <本次相关文件>
git commit -m "fix: describe the accepted change"
git tag -a <version-tag> -m "Accepted cross-device baseline"
```

标签是可恢复的时间点，不是“永远不会有问题”的承诺。
