import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createApiClient } from "../../api/client";
import type { ModelCatalog } from "../../types";
import { ModelConnectionManager } from "./ModelConnectionManager";

const catalog: ModelCatalog = {
  connections: [
    { id: "c1", name: "主连接", model_base_url: "https://first.example.test/v1", model_protocol: "auto", api_key_configured: true, enabled: true, revision: 3 },
    { id: "c2", name: "备用连接", model_base_url: "https://second.example.test/v1", model_protocol: "openai", api_key_configured: true, enabled: true, revision: 2 }
  ],
  profiles: [
    { id: "p1", connection_id: "c1", model_name: "first-model", enabled: true, revision: 1 },
    { id: "p2", connection_id: "c2", model_name: "second-model", enabled: true, revision: 2 }
  ], default_profile_id: "p1"
};
type Client = ReturnType<typeof createApiClient>;
type ManagerProps = Parameters<typeof ModelConnectionManager>[0];
function props(overrides: Partial<Omit<ManagerProps, "fetchJson">> & { fetchJson?: unknown } = {}): ManagerProps {
  return { catalog, loading: false, busy: false, error: "", fetchJson: vi.fn() as unknown as Client, onReload: vi.fn().mockResolvedValue(undefined), onMutate: vi.fn().mockResolvedValue(true), onDefaultChanged: vi.fn().mockResolvedValue(undefined), ...overrides } as ManagerProps;
}
afterEach(cleanup);

describe("ModelConnectionManager", () => {
  it("adds a connection with three required fields and clears its credential after submission", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByLabelText("连接 Base URL"), { target: { value: "https://new.example.test/v1" } });
    fireEvent.change(screen.getByLabelText(/^连接 API Key/), { target: { value: "test-only-new-key" } });
    fireEvent.change(screen.getByLabelText("首个模型名称"), { target: { value: "new-model" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveValue("");
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-connections", "POST", {
      name: "", model_base_url: "https://new.example.test/v1", model_protocol: "auto", api_key: "test-only-new-key", model_name: "new-model"
    }));
    await waitFor(() => expect(screen.queryByLabelText(/^连接 API Key/)).not.toBeInTheDocument());
    expect(page.onDefaultChanged).not.toHaveBeenCalled();
  });

  it("requires a new credential after changing the address of an existing connection", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getAllByRole("button", { name: "编辑连接" })[1]);
    fireEvent.change(screen.getByLabelText(/^连接 API Key/), { target: { value: "test-only-old-draft" } });
    fireEvent.change(screen.getByLabelText("连接 Base URL"), { target: { value: "https://changed.example.test/v1" } });
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveValue("");
    expect(screen.getByRole("button", { name: "保存连接" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^连接 API Key/), { target: { value: "test-only-new-address-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-connections/c2", "PATCH", expect.objectContaining({ expected_revision: 2, model_base_url: "https://changed.example.test/v1", api_key: "test-only-new-address-key" })));
  });

  it("clears a submitted key on failure and cancellation", async () => {
    const page = props({ onMutate: vi.fn().mockResolvedValue(false) });
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getAllByRole("button", { name: "编辑连接" })[1]);
    fireEvent.change(screen.getByLabelText(/^连接 API Key/), { target: { value: "test-only-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await screen.findByText(/密钥输入已清除/);
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveValue("");
    fireEvent.change(screen.getByLabelText(/^连接 API Key/), { target: { value: "test-only-cancel-key" } });
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    fireEvent.click(screen.getAllByRole("button", { name: "编辑连接" })[1]);
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveValue("");
  });

  it("adds another model to the chosen connection and applies a default only explicitly", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: /备用连接/ }));
    fireEvent.change(screen.getByLabelText("为 备用连接 添加模型"), { target: { value: "additional-model" } });
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-profiles", "POST", { connection_id: "c2", model_name: "additional-model" }));
    expect(page.onDefaultChanged).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "设为默认" })[1]);
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-default", "POST", { profile_id: "p2" }));
    await waitFor(() => expect(page.onDefaultChanged).toHaveBeenCalledOnce());
  });

  it("protects the default connection and confirms archival inside the module", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    expect(screen.getAllByRole("button", { name: "停用连接" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "停用模型" })[0]).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "停用连接" })[1]);
    expect(page.onMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-connections/c2", "DELETE"));
  });

  it("uses an expected profile revision when disabling a nondefault model", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getAllByRole("button", { name: "停用模型" })[1]);
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-profiles/p2", "PATCH", { enabled: false, expected_revision: 2 }));
  });

  it("locks default changes while the main default form has an unsaved draft", () => {
    render(<ModelConnectionManager {...props({ defaultLocked: true })} />);
    expect(screen.getAllByRole("button", { name: "设为默认" }).every(button => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByText(/默认配置有未保存的修改/)).toBeInTheDocument();
  });

  it("requests a catalog for the selected saved connection without accepting a draft URL or key", async () => {
    const fetchJson = vi.fn<ReturnType<typeof createApiClient>>().mockResolvedValue({ models: ["remote-model"] });
    render(<ModelConnectionManager {...props({ fetchJson })} />);
    fireEvent.click(screen.getByRole("button", { name: /备用连接/ }));
    fireEvent.click(screen.getByRole("button", { name: "读取模型列表" }));
    await screen.findByText(/已读取 1 个模型/);
    expect(fetchJson).toHaveBeenCalledWith("/agent/model-connections/c2/discover", expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }));
    expect(fetchJson.mock.calls[0][1]?.body).toBeUndefined();
  });
});
