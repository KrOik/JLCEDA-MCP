# 独立 MCP 使用

要求 Node.js 22 或更高版本。独立分发包内执行：

```sh
node scripts/service.mjs start
node scripts/service.mjs status
```

MCP 客户端连接 `http://127.0.0.1:7655/mcp`；嘉立创 EDA Bridge 连接 `ws://127.0.0.1:8765`。多个客户端共用这个后台服务。若客户端仅支持 stdio，使用 `node scripts/service.mjs stdio` 代理；不要另行启动第二个 standalone 服务入口。

执行 `bridge_status` 确认页面在线。同页连续操作无需重复填写目标字段；多页面或切页报错时再明确指定目标页面。

AI 使用 `component_select` 选择真实器件。`component_place.components[].nets` 可传引脚号到网名映射，一次调用先放置、再创建带 NET 名的真实导线并核验网表。已放置器件用 `pin_net_configure` 连接。默认不放符号；可选 terminal=port/power/ground 会先引线外移再放符号。预检和回读由工具内部执行；dryRun 仅用于预览或调试。

包装器发生兼容性错误时停止重试，按 Escape Hatch 回读已有图元后直接调用已核实签名的原生 API。不能绕过短接、切页或执行未决保护。连接失败不重新放置已经成功的器件。

后台保活使用服务端 WebSocket ping/pong，并容忍页面计时器暂停后的恢复。Bridge 传输层更新需要安装新 eext，不能仅靠任务 OTA；宿主完全冻结时仍不能保证任务执行。

批量失败后，`remainingIndices` 列出待处理项（从 0 开始）。对已有失败结果的项先回读，再续做；不要重新提交已成功的项。超时不代表没有写入。

完成连接后执行 `schematic_review`，核对实际网表与目标连接，并处理严格 DRC 和网表警告。仅成功放置器件或创建 NET 不能作为整板验收。

停止服务：`node scripts/service.mjs stop`。停止会影响所有共享客户端。
