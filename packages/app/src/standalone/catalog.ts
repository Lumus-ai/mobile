/**
 * Standalone provider/model catalog: a trimmed snapshot of the fork's
 * models.dev catalog plus the built-in free provider. Models for a provider
 * appear once its API key is stored on the device.
 */
import catalogData from "./catalog-models.json"
import { standaloneStore } from "./store"

type CatalogEntry = {
  integration: { id: string; name: string; methods: Array<Record<string, unknown>>; env: string[] }
  provider: Record<string, unknown>
  models: Array<Record<string, unknown>>
}

const catalog = catalogData as unknown as Record<string, CatalogEntry>

// Fill the fields the app's model normalization requires; pricing is unknown
// for user-keyed providers, so cost stays zero rather than inventing numbers.
function normalizedModels(entry: CatalogEntry): Array<Record<string, unknown>> {
  return entry.models.map((model) => ({
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    limit: { context: 128000, output: 8192 },
    status: "active",
    enabled: true,
    time: { released: 0 },
    ...model,
  }))
}

export const standaloneCatalog = {
  integrations() {
    return Object.values(catalog).map((entry) => ({
      ...entry.integration,
      connections: standaloneStore.keys.get(entry.integration.id)
        ? [{ type: "key", connected: standaloneStore.keys.get(entry.integration.id)!.connected }]
        : [],
    }))
  },
  providers() {
    // The opencode free tier refuses direct app calls (FreeTierError), so it
    // is excluded: only providers with a stored API key appear.
    const list: Array<Record<string, unknown>> = []
    for (const entry of Object.values(catalog)) {
      if (entry.integration.id === "opencode") continue
      if (standaloneStore.keys.get(entry.integration.id)) list.push({ ...entry.provider, activation: "auto" })
    }
    return list
  },
  models() {
    const list: Array<Record<string, unknown>> = []
    for (const entry of Object.values(catalog)) {
      if (entry.integration.id === "opencode") continue
      if (standaloneStore.keys.get(entry.integration.id)) list.push(...normalizedModels(entry))
    }
    return list
  },
  modelInfo(providerID: string, modelID: string) {
    return catalog[providerID]?.models.find((item) => (item as { id?: string }).id === modelID)
  },
  defaultModel() {
    for (const entry of Object.values(catalog)) {
      if (entry.integration.id === "opencode") continue
      if (!standaloneStore.keys.get(entry.integration.id)) continue
      const first = entry.models[0] as { id: string; providerID: string } | undefined
      if (first) return { id: first.id, providerID: first.providerID }
    }
    return undefined
  },
}
