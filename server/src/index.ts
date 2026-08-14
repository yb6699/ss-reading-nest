import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
createApp().listen(port, () => {
  console.log(`和G老师一起读书 MCP server: http://localhost:${port}/mcp`);
});
