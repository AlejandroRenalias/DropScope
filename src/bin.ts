#!/usr/bin/env node
// The entry point of the `dropscope` command. It lives apart from run-cli.ts because an installed command is a
// link to this file: run-cli.ts compares its own path with the path it was started from, which differs for a link.
import { runCli } from "./run-cli.js";

process.exitCode = runCli(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
