import type { ApiConfig } from "./config";
import { InMemorySessionStore } from "./sessionStore";
import type { SessionStore } from "./store";
import { SupabaseSessionStore } from "./supabaseSessionStore";

export function createSessionStore(config: ApiConfig): SessionStore {
  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    return SupabaseSessionStore.create({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.supabaseServiceRoleKey,
    });
  }

  return new InMemorySessionStore({
    ownerGraceSeconds: config.ownerGraceSeconds,
    localEntitlements: config.localEntitlements,
  });
}
