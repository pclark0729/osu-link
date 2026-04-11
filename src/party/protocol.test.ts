import { describe, expect, it } from "vitest";
import { PARTY_PROTOCOL_VERSION, parseServerMessage } from "./protocol";

describe("parseServerMessage", () => {
  it("parses beatmap_queued with queuedAfter", () => {
    const raw = JSON.stringify({
      type: "beatmap_queued",
      v: PARTY_PROTOCOL_VERSION,
      seq: 2,
      fromMemberId: "m1",
      setId: 42,
      noVideo: false,
      artist: "Artist",
      title: "Title",
      queuedAfter: [
        {
          seq: 1,
          setId: 41,
          noVideo: true,
          fromMemberId: "m0",
        },
      ],
    });
    const msg = parseServerMessage(raw);
    expect(msg).not.toBeNull();
    expect(msg?.type).toBe("beatmap_queued");
    if (msg?.type !== "beatmap_queued") return;
    expect(msg.setId).toBe(42);
    expect(msg.fromMemberId).toBe("m1");
    expect(msg.queuedAfter).toHaveLength(1);
    expect(msg.queuedAfter[0]?.setId).toBe(41);
  });

  it("returns null for wrong protocol version", () => {
    const raw = JSON.stringify({ type: "error", v: 1, message: "bad" });
    expect(parseServerMessage(raw)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseServerMessage("not json")).toBeNull();
  });
});
