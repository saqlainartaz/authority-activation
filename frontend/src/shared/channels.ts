export const CHANNELS = {
  li: { canonical: "linkedin", label: "LinkedIn", assetKind: "linkedin_post", skill: "linkedin-post" },
  ig: { canonical: "instagram", label: "Instagram", assetKind: "instagram_post", skill: "instagram-post" },
  x: { canonical: "x", label: "X", assetKind: "x_post", skill: "x-post" },
  fb: { canonical: "facebook", label: "Facebook", assetKind: "facebook_post", skill: "facebook-post" },
} as const;

export type Channel = keyof typeof CHANNELS;
export type SocialPlatform = (typeof CHANNELS)[Channel]["canonical"];
export const CHANNEL_KEYS = Object.keys(CHANNELS) as Channel[];
export const DEFAULT_CHANNEL: Channel = "li";

export function channelFromPlatform(platform: SocialPlatform): Channel {
  const found = CHANNEL_KEYS.find((key) => CHANNELS[key].canonical === platform);
  if (found === undefined) throw new Error(`Unsupported social platform: ${platform}`);
  return found;
}

export function channelFromAssetKind(assetKind: string): Channel | null {
  return CHANNEL_KEYS.find((key) => CHANNELS[key].assetKind === assetKind) ?? null;
}

/** Select only channels the client explicitly names; arbitrary strings fail closed. */
export function channelsFromIntent(text: string): Channel[] {
  const requested = new Set<Channel>();
  const normalized = text.toLowerCase();
  if (/\blinked\s*in\b/.test(normalized)) requested.add("li");
  if (/\binstagram\b|\binsta\b/.test(normalized)) requested.add("ig");
  if (/\bfacebook\b/.test(normalized)) requested.add("fb");
  if (/\btwitter\b|\bx post\b|\bpost (?:for|on) x\b|(?:^|[^a-z0-9])x(?:$|[^a-z0-9])/.test(normalized)) requested.add("x");
  return CHANNEL_KEYS.filter((channel) => requested.has(channel));
}
