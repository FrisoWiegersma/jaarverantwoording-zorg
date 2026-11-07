import { tool } from "@langchain/core/tools";
import { StateSchema } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { generateSystemPrompt } from "@openuidev/lang-core";
import { createAgent, createMiddleware } from "langchain";
import { z } from "zod";
import librarySpec from "./generated/spec.json";
import { requiredEnv } from "./lib/env";
import { DEFAULT_MODEL } from "./lib/models";
import { executeGetWeather, getWeatherTool } from "./lib/tools/get-weather";

// The generated spec carries the library and its prompt options; generateSystemPrompt takes them separately.
const { promptOptions, ...library } = librarySpec;

const getWeather = tool(
  async ({ location }, config) =>
    executeGetWeather(JSON.stringify({ location }), { signal: config.signal }),
  {
    name: "get_weather",
    description: getWeatherTool.description,
    schema: z.object({
      location: z.string().trim().min(1).describe("City or place name, e.g. Berlin."),
    }),
  },
);

const AgentState = new StateSchema({
  model: z.string().default(DEFAULT_MODEL),
});

// Gemini's own client, not its OpenAI-compatible endpoint: Gemini 3 needs each tool call's thought
// signature sent back, which the OpenAI client drops. Same GEMINI_API_KEY as ../web.
function geminiModel(model: string) {
  return new ChatGoogleGenerativeAI({ model, apiKey: requiredEnv("GEMINI_API_KEY"), streaming: true });
}

const selectedModel = createMiddleware({
  name: "SelectedModel",
  stateSchema: AgentState,
  wrapModelCall: async (request, handler) => {
    const { model } = request.state as unknown as { model: string };
    return handler({ ...request, model: geminiModel(model) });
  },
});

// ponytail: no conversation storage (that was OpenUI Cloud); chats live in the browser tab only.
/** LangGraph owns the tool loop; Gemini answers. The full OpenUI prompt is generated here, not by Cloud. */
export const graph = createAgent({
  model: geminiModel(DEFAULT_MODEL),
  tools: [getWeather],
  systemPrompt: generateSystemPrompt({ library, promptOptions }),
  stateSchema: AgentState,
  middleware: [selectedModel],
});
