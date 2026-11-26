import { createTmdbSearchProvider, type MediaSearchProvider } from "@media-track/workflow";
import { getAccountScopedSettings, getTmdbAccesses } from "../workflow-runtime";

export async function getAgentMediaSearchProvider(accountId: string): Promise<MediaSearchProvider> {
  const settings = getAccountScopedSettings(accountId);
  return createTmdbSearchProvider(await getTmdbAccesses(settings));
}
