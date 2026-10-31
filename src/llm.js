import { ChatOpenAI } from "@langchain/openai";

// Works for Groq and xAI: only apiKey / baseUrl / model change.
export const makeLlm = ({ apiKey, baseUrl, model }) =>
  new ChatOpenAI({ apiKey, model, temperature: 0, maxRetries: 4, configuration: { baseURL: baseUrl } });
