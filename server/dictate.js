// Speech for a box the person will edit. Local Whisper first, then a connected AI.
import { transcribeAudio } from "./speech.js";
import { transcribeWhisper } from "./local-whisper.js";

export async function transcribeWithFallback(audio, deps) {
  const local = await transcribeWhisper(audio);
  if (local?.text) return local;
  return transcribeAudio(audio, deps);
}
