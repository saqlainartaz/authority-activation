import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The card's confirm route, driven through its real `POST`.
 *
 * Review 5 (S2): the route's local-time check had lost its backslashes
 * (`d{4}` for `\d{4}`), so EVERY changed time the card's editor sent got a
 * 422 before Python saw it, and only the originally proposed time could be
 * confirmed. The card's own view tests could not see it: they never cross
 * this route. The session and product client are mocked so the route's own
 * check is the thing under test.
 */
const confirmScheduleProposal = vi.fn();

vi.mock("@/lib/client-session", () => ({ clientToken: async () => "token" }));
vi.mock("@/lib/product", () => ({
  confirmScheduleProposal: (...args: unknown[]) => confirmScheduleProposal(...args),
  expiredLinkResponse: () => Response.json({ error: "expired" }, { status: 401 }),
  forwardProductError: () => Response.json({ error: "failed" }, { status: 502 }),
  readJsonObject: async (request: Request) => (await request.json()) as Record<string, unknown>,
}));

const { POST } = await import(
  "@/app/api/client/chat/sessions/[sessionId]/schedule-proposals/[proposalId]/confirm/route"
);

const SESSION = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "22222222-2222-4222-8222-222222222222";

function confirm(body: Record<string, unknown>) {
  return POST(new Request("http://local/confirm", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ sessionId: SESSION, proposalId: PROPOSAL }),
  });
}

describe("confirming a schedule card", () => {
  beforeEach(() => {
    confirmScheduleProposal.mockReset();
    confirmScheduleProposal.mockResolvedValue({ status: "confirmed" });
  });

  it("forwards a changed time from the card's editor to the server", async () => {
    const response = await confirm({ when: "2026-10-03T09:00" });

    expect(response.status).toBe(200);
    expect(confirmScheduleProposal).toHaveBeenCalledWith("token", SESSION, PROPOSAL, { when: "2026-10-03T09:00" });
  });

  it("confirms the proposed time when nothing was changed", async () => {
    const response = await confirm({});

    expect(response.status).toBe(200);
    expect(confirmScheduleProposal).toHaveBeenCalledWith("token", SESSION, PROPOSAL, {});
  });

  it.each(["dddd-dd-ddTdd:dd", "2026-10-03T24:00", "2026-10-03 09:00", "2026-10-03T09:00Z"])(
    "refuses %s before it reaches the server",
    async (when) => {
      const response = await confirm({ when });

      expect(response.status).toBe(422);
      expect(confirmScheduleProposal).not.toHaveBeenCalled();
    },
  );
});
