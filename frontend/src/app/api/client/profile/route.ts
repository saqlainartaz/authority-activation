// GET /api/client/profile -> exact, tenant-derived profile facts.
//
// `client_id` is routing data authored by the token-authenticated campaign
// envelope. It is deliberately never returned to the browser.

import { clientToken } from "@/lib/client-session";
import { computeGroundingGap } from "@/lib/grounding-gap";
import {
  EngineHttpError,
  forwardEngineError,
  listClients,
  listDocuments,
} from "@/lib/engine";
import {
  clientConsole,
  expiredLinkResponse,
  forwardProductError,
  getOnboarding,
  listClientCampaigns,
} from "@/lib/product";

const TOPIC_SOURCE_TYPES = ["insight", "quote", "objection", "proof_point"] as const;

function topicSuggestions(answers: Record<string, unknown>): Array<{ text: string; trust: "untrusted" }> {
  const seen = new Set<string>();
  const suggestions: Array<{ text: string; trust: "untrusted" }> = [];
  for (const sourceType of TOPIC_SOURCE_TYPES) {
    const values = answers[sourceType];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (typeof value !== "string") continue;
      const text = value.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      suggestions.push({ text, trust: "untrusted" });
      if (suggestions.length === 3) return suggestions;
    }
  }
  return suggestions;
}

export async function GET() {
  const token = await clientToken();
  if (!token) return expiredLinkResponse();

  try {
    // The campaign envelope is the only session-authenticated source of the
    // tenant route. It is read once and reduced before response construction.
    const envelope = await listClientCampaigns(token);
    const clientId = envelope.client_id;
    const [clients, documents, console_, onboarding] = await Promise.all([
      listClients(),
      listDocuments(clientId),
      clientConsole(clientId),
      getOnboarding(token),
    ]);
    const client = clients.find(({ id }) => id === clientId);
    if (!client) {
      throw new EngineHttpError("Client not found", 404, "Client not found");
    }

    const latestDocument = documents.reduce<string | null>(
      (latest, document) => !latest || document.created_at > latest ? document.created_at : latest,
      null,
    );
    const groundingGap = computeGroundingGap(console_.atom_counts);

    return Response.json({
      identity: {
        display_name: onboarding.user.display_name,
        email: onboarding.user.email,
        profession: onboarding.user.profession,
        client_name: client.name,
        timezone: client.timezone,
      },
      voice_profile: {
        latest_version: console_.voice_profile.latest_version,
        approved_version: console_.voice_profile.approved_version,
      },
      document_count: documents.length,
      atom_count: groundingGap.atom_count,
      grounding_gap: groundingGap,
      last_ingested_at: latestDocument,
      topic_suggestions: topicSuggestions(onboarding.answers),
      campaigns: envelope.campaigns.map((campaign) => ({
        campaign_id: campaign.campaign_id,
        period_id: campaign.period_id,
        play_id: campaign.play_id,
        objective: campaign.objective,
        starts_on: campaign.starts_on,
        ends_on: campaign.ends_on,
        is_active: campaign.is_active,
        created_at: campaign.created_at,
      })),
      active_count: envelope.active_count,
      active_cap: envelope.active_cap,
      generated_at: envelope.generated_at,
      campaign_setup: {
        plays: console_.plays.map((play) => ({
          play_id: play.play_id,
          eligible: play.eligible,
        })),
        selected_play_id: console_.selected_play_id,
      },
    });
  } catch (error) {
    return error instanceof EngineHttpError ? forwardEngineError(error) : forwardProductError(error);
  }
}
