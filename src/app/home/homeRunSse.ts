import type { RunStreamComplete } from "@/app/home/homeTypes";

export function consumeRunSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onProgress: (message: string) => void,
  onAiStream?: (phase: string, delta: string) => void
): Promise<RunStreamComplete> {
  const decoder = new TextDecoder();
  let buffer = "";

  const handleBlock = (block: string): RunStreamComplete | null => {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(line.slice(6)) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (json.type === "progress" && typeof json.message === "string") {
        onProgress(json.message);
      }
      if (
        json.type === "ai_stream" &&
        typeof json.phase === "string" &&
        typeof json.delta === "string"
      ) {
        onAiStream?.(json.phase, json.delta);
      }
      if (json.type === "complete") {
        return json as RunStreamComplete;
      }
    }
    return null;
  };

  return (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          const last = handleBlock(buffer);
          if (last) return last;
        }
        throw new Error("サーバーからの応答が途中で切れました");
      }
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const complete = handleBlock(chunk);
        if (complete) return complete;
      }
    }
  })();
}
