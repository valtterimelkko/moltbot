import type { MoltbotConfig } from "../config/config.js";
import type { ModelRef } from "./model-selection.js";
import { parseModelRef } from "./model-selection.js";
import { DEFAULT_PROVIDER } from "./defaults.js";

export type TaskType = "file-analysis" | "creative" | "debugging" | "cli" | "general";

/**
 * Detect task type from user message using keyword analysis
 */
export function detectTaskType(userMessage: string): TaskType {
  if (!userMessage || typeof userMessage !== "string") {
    return "general";
  }

  const messageLower = userMessage.toLowerCase();

  // File analysis tasks - route to Gemini for large context window
  if (
    messageLower.includes("file") ||
    messageLower.includes("read") ||
    messageLower.includes("analyze") ||
    messageLower.includes("directory") ||
    messageLower.includes("folder") ||
    messageLower.includes("content of") ||
    messageLower.includes("examine") ||
    messageLower.includes("inspect") ||
    messageLower.includes("scan") ||
    messageLower.includes("browse") ||
    messageLower.includes("list files") ||
    messageLower.includes("show files")
  ) {
    return "file-analysis";
  }

  // Creative content tasks - route to Llama for stylistic versatility
  if (
    messageLower.includes("write") ||
    messageLower.includes("create") ||
    messageLower.includes("content") ||
    messageLower.includes("story") ||
    messageLower.includes("poem") ||
    messageLower.includes("article") ||
    messageLower.includes("compose") ||
    messageLower.includes("draft") ||
    messageLower.includes("generate") ||
    messageLower.includes("summarize") ||
    messageLower.includes("explain") ||
    messageLower.includes("describe")
  ) {
    return "creative";
  }

  // Debugging tasks - route to Claude for complex reasoning
  if (
    messageLower.includes("debug") ||
    messageLower.includes("error") ||
    messageLower.includes("fix") ||
    messageLower.includes("troubleshoot") ||
    messageLower.includes("complex") ||
    messageLower.includes("problem") ||
    messageLower.includes("issue") ||
    messageLower.includes("bug") ||
    messageLower.includes("broken") ||
    messageLower.includes("not working") ||
    messageLower.includes("failed") ||
    messageLower.includes("crash")
  ) {
    return "debugging";
  }

  // CLI/terminal tasks - route to Mistral for agentic workflows
  if (
    messageLower.includes("terminal") ||
    messageLower.includes("command") ||
    messageLower.includes("cli") ||
    messageLower.includes("exec") ||
    messageLower.includes("bash") ||
    messageLower.includes("shell") ||
    messageLower.includes("run") ||
    messageLower.includes("execute") ||
    messageLower.includes("script") ||
    messageLower.includes("install") ||
    messageLower.includes("update") ||
    messageLower.includes("upgrade")
  ) {
    return "cli";
  }

  return "general";
}

/**
 * Map task types to optimal models based on your LLM strategy
 */
export function resolveModelForTaskType(taskType: TaskType, _cfg: MoltbotConfig): ModelRef | null {
  // Define the optimal model mapping based on your strategy
  const TASK_TYPE_MODEL_MAPPING: Record<TaskType, string> = {
    "file-analysis": "openrouter/google/gemini-2.0-flash", // 1M context for spatial reasoning
    creative: "openrouter/meta-llama/llama-3.3-70b-instruct", // Best for pedagogical content
    debugging: "anthropic/claude-sonnet-4-5", // Complex reasoning specialist
    cli: "openrouter/mistralai/mistral-devstral-2", // Agentic workflow specialist
    general: "openrouter/mistralai/mistral-devstral-2", // Default to agentic specialist
  };

  const modelRef = TASK_TYPE_MODEL_MAPPING[taskType];
  return parseModelRef(modelRef, DEFAULT_PROVIDER);
}

/**
 * Enhanced model resolution that considers task type for optimal routing
 */
export function resolveModelForAgentWithTaskRouting(params: {
  cfg: MoltbotConfig;
  agentId?: string;
  userMessage?: string;
  defaultModelRef: ModelRef;
}): ModelRef {
  // If we have a user message, use task-type routing
  if (params.userMessage) {
    const taskType = detectTaskType(params.userMessage);
    const taskModel = resolveModelForTaskType(taskType, params.cfg);

    if (taskModel) {
      return taskModel;
    }
  }

  // Fall back to the default model
  return params.defaultModelRef;
}
