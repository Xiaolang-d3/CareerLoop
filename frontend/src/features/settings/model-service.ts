import type { ModelCatalog } from "../../types";

/** Keep the service used by the existing default; old connections remain for history. */
export function currentModelService(catalog: ModelCatalog) {
  const preferred = catalog.service_connection_id ?? catalog.profiles.find(profile => profile.id === catalog.default_profile_id)?.connection_id;
  return catalog.connections.find(connection => connection.id === preferred && connection.enabled)
    ?? catalog.connections.find(connection => connection.enabled)
    ?? null;
}
