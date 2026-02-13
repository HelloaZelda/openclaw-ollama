import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime = undefined as unknown as PluginRuntime;
let runtimeSet = false;

export function setQqRuntime(next: PluginRuntime) {
  runtime = next;
  runtimeSet = true;
}

export function getQqRuntime(): PluginRuntime {
  if (!runtimeSet) {
    throw new Error("QQ runtime not initialized");
  }
  return runtime;
}
