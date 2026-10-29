import { describe, expect, it } from "vitest";
import type { ModelCatalog } from "../../types";
import { currentModelService } from "./model-service";

const catalog: ModelCatalog = {
  connections: [
    { id: "original", name: "原服务", model_base_url: "https://original.example.test/v1", model_protocol: "auto", api_key_configured: true, enabled: true, revision: 1 },
    { id: "historical", name: "历史连接", model_base_url: "https://historical.example.test/v1", model_protocol: "auto", api_key_configured: true, enabled: true, revision: 1 }
  ],
  profiles: [
    { id: "chat", connection_id: "original", model_name: "gpt-4.1", enabled: true, revision: 1 },
    { id: "image", connection_id: "historical", model_name: "gpt-image-2", enabled: true, revision: 1 }
  ],
  default_profile_id: "image"
};

describe("currentModelService", () => {
  it("keeps the selected service when the global default belongs to a historical connection", () => {
    expect(currentModelService({ ...catalog, service_connection_id: "original" })).toEqual(catalog.connections[0]);
    expect(currentModelService({ ...catalog, service_connection_id: "original", default_profile_id: "chat" })).toEqual(catalog.connections[0]);
  });

  it("inherits the default model connection for a legacy catalog without a service ID", () => {
    expect(currentModelService(catalog)).toEqual(catalog.connections[1]);
  });

  it("chooses the first enabled connection when no default is configured", () => {
    expect(currentModelService({ ...catalog, default_profile_id: null, connections: [{ ...catalog.connections[0], enabled: false }, catalog.connections[1]] })).toEqual(catalog.connections[1]);
  });

  it("returns null when there is no enabled service", () => {
    expect(currentModelService({ connections: [], profiles: [], default_profile_id: null })).toBeNull();
    expect(currentModelService({ ...catalog, connections: catalog.connections.map(connection => ({ ...connection, enabled: false })) })).toBeNull();
  });
});
