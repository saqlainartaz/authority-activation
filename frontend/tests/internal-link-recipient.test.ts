import { describe, expect, it } from "vitest";
import { selectLinkRecipient } from "../src/app/api/internal/client-login-link/recipient";

const clientPeople = [{ id: "person-one" }, { id: "person-two" }];

describe("selectLinkRecipient", () => {
  it("uses the explicitly selected person rather than the first person", () => {
    expect(selectLinkRecipient(clientPeople, "person-two")).toBe("person-two");
  });

  it("rejects a person not present in this client's list", () => {
    expect(selectLinkRecipient(clientPeople, "other-client-person")).toBeNull();
  });

  it("retains the first-person default for older callers", () => {
    expect(selectLinkRecipient(clientPeople, undefined)).toBe("person-one");
  });

  it("rejects malformed explicit selections", () => {
    expect(selectLinkRecipient(clientPeople, "")).toBeNull();
    expect(selectLinkRecipient(clientPeople, 7)).toBeNull();
  });
});
