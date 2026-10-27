// Image AIs as media adapters (0.4.21): OpenAI GPT-Image, Google Gemini, xAI, Replicate (Flux). A mission's image step
// used to go to fal.ai only, so with no fal key it ended as a placeholder. These use the keys the person already
// saved for those AIs, through the same code as the Images tab (server/images.js).
import { IMAGE_PROVIDERS, rawImage, imageProviderInfo } from "../images.js";

const SIZE = { square: "square", portrait: "portrait", landscape: "landscape" };
function make(pid) {
  const pv = IMAGE_PROVIDERS[pid];
  return {
    id: pid, name: pv.name, kinds: ["image"], defaults: { model: pv.defaultModel }, imageAi: true,
    estimate() {
      const info = imageProviderInfo(pid);
      return { usd: info.usd, note: `1 image · ${pv.models[pv.defaultModel].name}` };
    },
    async start(secret, params) {
      const size = SIZE[params.size] || (/portrait|9:16|2:3/.test(String(params.aspect || params.ratio || "")) ? "portrait" : /landscape|16:9|3:2/.test(String(params.aspect || params.ratio || "")) ? "landscape" : "square");
      const pics = await rawImage(pid, { prompt: params.prompt || params.text, size, model: params.model });
      return { done: true, bytes: pics[0].bytes, ext: pics[0].ext };
    },
  };
}
export const IMAGE_AI = Object.fromEntries(["openai", "google", "xai", "replicate"].map((pid) => [pid, make(pid)]));
