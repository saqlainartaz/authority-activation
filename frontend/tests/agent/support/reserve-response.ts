/**
 * What `POST /v1/chat/sessions/{id}/turn-budget` answers to a `reserve` (Cycle 5,
 * P1.5): the reservation, plus the bounds the agent enforces and the prices the
 * reservation was derived at. Values as the backend computes them at its
 * defaults (`src/content_engine/ke/reply_bounds.py`, `tests/test_ke_reply_bounds.py`).
 *
 * `max_call_output_tokens` must equal `loop.ts`'s `MAX_TOKENS`, and the backend's
 * `MAX_CALL_OUTPUT_TOKENS`: the reservation assumes no call writes more.
 */
export const RESERVE_RESPONSE = {
  call_id: "6f1c1d1e-2a3b-4c5d-8e9f-0a1b2c3d4e5f",
  reserved_microdollars: 1_852_400,
  reply_cap_microdollars: 1_000_000,
  max_call_input_tokens: 120_000,
  max_call_output_tokens: 4_096,
  prices: {
    "claude-opus-5": { input: 5_000_000, cache_write_5m: 6_250_000, cache_read: 500_000, output: 25_000_000 },
    "claude-sonnet-5": { input: 2_000_000, cache_write_5m: 2_500_000, cache_read: 200_000, output: 10_000_000 },
    "claude-haiku-4-5-20251001": { input: 1_000_000, cache_write_5m: 1_250_000, cache_read: 100_000, output: 5_000_000 },
  },
} as const;
