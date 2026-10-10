import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type createApiClient } from "../../api/client";
import type { ModelCatalog, ModelFallbackPolicy } from "../../types";
import { ModelFallbackSettings } from "./ModelFallbackSettings";

type Client = ReturnType<typeof createApiClient>;
afterEach(cleanup);

const catalog: ModelCatalog = {
  connections: [
    { id: "c1", name: "主连接", model_base_url: "https://a.example.test/v1", model_protocol: "openai", api_key_configured: true, enabled: true, revision: 1 },
    { id: "c2", name: "Claude", model_base_url: "https://b.example.test", model_protocol: "anthropic", api_key_configured: true, enabled: true, revision: 1 }
  ],
  profiles: [
    { id: "p1", connection_id: "c1", model_name: "gpt-4o", enabled: true, revision: 1 },
    { id: "p2", connection_id: "c2", model_name: "claude-sonnet-4-5", enabled: true, revision: 1 },
    { id: "p3", connection_id: "c2", model_name: "claude-haiku-4-5", enabled: true, revision: 1 },
    { id: "p4", connection_id: "c2", model_name: "disabled-model", enabled: false, revision: 1 }
  ],
  default_profile_id: "p1"
};
const policy: ModelFallbackPolicy = {
  enabled: false, fallback_profile_ids: [], context_window_profile_ids: [], content_policy_profile_ids: [],
  retry_policy: { timeout: 0, rate_limit: 0, server_error: 0 }, allowed_fails: 3, cooldown_seconds: 60, revision: 4, backend: "litellm"
};

describe("ModelFallbackSettings", () => {
  it("orders fallbacks, sets retries and cooldown, and saves with the revision", async () => {
    const fetchJson = vi.fn().mockResolvedValueOnce(policy).mockImplementationOnce(async (_path: string, init: RequestInit) => ({ ...JSON.parse(String(init.body)), revision: 5, backend: "litellm" }));
    render(<ModelFallbackSettings catalog={catalog} fetchJson={fetchJson as unknown as Client} busy={false} />);
    fireEvent.click(await screen.findByLabelText("启用备用模型"));
    expect(screen.queryByText("disabled-model")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("备用模型：claude-haiku-4-5（Claude）"));
    fireEvent.click(screen.getByLabelText("备用模型：claude-sonnet-4-5（Claude）"));
    fireEvent.click(screen.getByLabelText("超长上下文时换用：claude-sonnet-4-5（Claude）"));
    fireEvent.change(screen.getByLabelText("限流重试"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("服务错误重试"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("冷却时间（秒）"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "保存备用模型" }));
    await screen.findByText(/备用模型设置已保存/);
    const [path, init] = fetchJson.mock.calls[1];
    expect(path).toBe("/agent/model-fallbacks");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      enabled: true, fallback_profile_ids: ["p3", "p2"], context_window_profile_ids: ["p2"], content_policy_profile_ids: [],
      retry_policy: { timeout: 0, rate_limit: 2, server_error: 3 }, allowed_fails: 3, cooldown_seconds: 120, expected_revision: 4
    });
    expect(screen.getByRole("button", { name: "保存备用模型" })).toBeDisabled();
  });

  it("limits special fallbacks to two models", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ ...policy, enabled: true });
    render(<ModelFallbackSettings catalog={catalog} fetchJson={fetchJson as unknown as Client} busy={false} />);
    for (const name of ["gpt-4o（主连接）", "claude-sonnet-4-5（Claude）", "claude-haiku-4-5（Claude）"]) {
      fireEvent.click(await screen.findByLabelText(`内容被拒时换用：${name}`));
    }
    expect(screen.getByLabelText("内容被拒时换用：claude-haiku-4-5（Claude）")).not.toBeChecked();
  });

  it("reloads after a revision conflict and warns when the native backend is active", async () => {
    const fetchJson = vi.fn()
      .mockResolvedValueOnce({ ...policy, enabled: true, backend: "native" })
      .mockRejectedValueOnce(new ApiError("conflict", 409))
      .mockResolvedValueOnce({ ...policy, enabled: true, revision: 6, backend: "native" });
    render(<ModelFallbackSettings catalog={catalog} fetchJson={fetchJson as unknown as Client} busy={false} />);
    expect(await screen.findByText(/原生模型层/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("备用模型：claude-sonnet-4-5（Claude）"));
    fireEvent.click(screen.getByRole("button", { name: "保存备用模型" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("已在其他页面更新");
    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(3));
  });
});
