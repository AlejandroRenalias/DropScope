import { join } from "node:path";
import { LocalMissionRuntime } from "./runtime/local-mission-runtime.js";
import { listenLocalRuntimeServer } from "./local-runtime-server.js";

const runtime = new LocalMissionRuntime({ dataRoot: join(process.cwd(), ".dropscope-data") });
const server = await listenLocalRuntimeServer(runtime, { port: 8787, trustedUiOrigin: process.env.DROPSCOPE_TRUSTED_UI_ORIGIN });
console.log("DropScope local runtime listening at http://127.0.0.1:8787");

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await server.close();
};
process.once("SIGINT", () => { void close().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void close().finally(() => process.exit(0)); });
