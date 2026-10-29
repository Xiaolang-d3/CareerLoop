import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type createApiClient } from "../../api/client";
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
  return { catalog, loading: false, busy: false, error: "", fetchJson: vi.fn().mockImplementation(async (path: string) => ({ models: [path.includes("c2") ? "second-model" : "first-model"] })) as unknown as Client, onReload: vi.fn().mockResolvedValue(undefined), onMutate: vi.fn().mockResolvedValue(true), onDefaultChanged: vi.fn().mockResolvedValue(undefined), ...overrides } as ManagerProps;
}
afterEach(cleanup);
async function openModelSettings(connection: string, model: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(connection) }));
  fireEvent.click(await screen.findByRole("button", { name: `${model} 设置` }));
}
function moreOptions() { fireEvent.click(screen.getByText("更多选项")); }


describe("ModelConnectionManager", async () => {
  it("presents one service directly even when two historical connections exist", async () => {
    const page = props({ catalog: { ...catalog, service_connection_id: "c1", purpose_defaults: { chat: "p1", image: null }, purpose_version: 1 }, fetchJson: vi.fn().mockResolvedValue({ models: ["gpt-image-2", "gpt-4.1", "sora-2"] }), onEnsureProfile: vi.fn().mockResolvedValue("new-profile") });
    render(<ModelConnectionManager {...page} singleService />);
    expect(screen.queryByRole("button", { name: "添加连接" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /展开后读取服务模型/ })).not.toBeInTheDocument();
    expect(screen.queryByText("备用连接")).not.toBeInTheDocument();
    expect(screen.getByText("https://first.example.test/v1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "first-model 设置" })).toBeInTheDocument();
    expect(page.fetchJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "读取模型列表" }));
    await screen.findByRole("button", { name: "gpt-image-2 设置" });
    expect(page.fetchJson).toHaveBeenCalledWith("/agent/model-connections/c1/discover", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "编辑服务" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "编辑服务" })).toContainElement(screen.getByLabelText("服务地址（Base URL）"));
    fireEvent.click(screen.getByRole("button", { name: "保存服务" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-connections/c1", "PATCH", expect.objectContaining({ model_base_url: "https://first.example.test/v1" })));
    expect(page.onMutate).not.toHaveBeenCalledWith("/agent/model-connections", "POST", expect.anything());
  });
  it("reads models with only four category filters and no search or manual entry", async () => {
    const page = props({
      catalog: { ...catalog, service_connection_id: "c1", purpose_defaults: { chat: null, image: null } },
      fetchJson: vi.fn().mockResolvedValue({ models: ["gpt-4.1", "gpt-image-2", "sora-2", "private-alias", ...Array.from({ length: 6 }, (_, index) => `custom-${index}`)] })
    });
    render(<ModelConnectionManager {...page} singleService />);
    const filters = screen.getByRole("group", { name: "按模型输出筛选" });
    expect(within(filters).getAllByRole("button").map(button => button.textContent)).toEqual(["全部", "对话", "图片", "视频"]);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/手动添加/)).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole("button", { name: "对话" }));
    expect(screen.getByText("当前分类下没有模型，可切换分类或重新读取模型。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "读取模型列表" }));
    await screen.findByRole("button", { name: "gpt-4.1 设置" });
    expect(screen.queryByRole("button", { name: "gpt-image-2 设置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/手动添加/)).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole("button", { name: "图片" }));
    expect(screen.getByRole("button", { name: "gpt-image-2 设置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gpt-4.1 设置" })).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole("button", { name: "视频" }));
    expect(screen.getByRole("button", { name: "sora-2 设置" })).toBeInTheDocument();
    fireEvent.click(within(filters).getByRole("button", { name: "全部" }));
    expect(screen.getByRole("button", { name: "private-alias 设置" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "待确认" })).not.toBeInTheDocument();
  });
  it("shows saved models without contacting the provider and separates enabling from defaults", async () => {
    const page = props({ catalog: { ...catalog, connections: [catalog.connections[0]], purpose_defaults: { chat: null, image: null }, purpose_version: 1 }, fetchJson: vi.fn().mockResolvedValue({ models: ["gpt-image-2", "private-alias"] }), onEnsureProfile: vi.fn().mockResolvedValue("new-profile") });
    render(<ModelConnectionManager {...page} />);
    expect(screen.getByRole("button", { name: "first-model 设置" })).toBeInTheDocument();
    expect(page.fetchJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "读取模型列表" }));
    fireEvent.click(await screen.findByRole("button", { name: "gpt-image-2 启用模型" }));
    await waitFor(() => expect(page.onEnsureProfile).toHaveBeenCalledWith("c1", "gpt-image-2", 3));
    expect(page.onMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "待确认" }));
    expect(screen.queryByRole("button", { name: "gpt-image-2 设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "private-alias 设置" })).toBeInTheDocument();
  });
  it("edits a connection inline without opening a modal", () => {
    render(<ModelConnectionManager {...props()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "编辑连接" })[0]);
    expect(screen.getByRole("region", { name: "编辑连接" })).toContainElement(screen.getByLabelText("连接 Base URL"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(screen.queryByRole("region", { name: "编辑连接" })).not.toBeInTheDocument();
  });
  it("explains how to recover when the backend has not loaded the reveal endpoint", async () => {
    const fetchJson = vi.fn().mockRejectedValue(new ApiError("Method Not Allowed", 405));
    render(<ModelConnectionManager {...props({ fetchJson })} />);
    fireEvent.click(screen.getAllByRole("button", { name: "编辑连接" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "查看 API Key" }));
    expect(await screen.findByText(/请重启后端服务后重试/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveAttribute("type", "password");
  });
  it("labels inferred output types and prevents selecting unimplemented video", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ models: ["gpt-image-2", "sora-2"] });
    render(<ModelConnectionManager {...props({ fetchJson, onEnsureProfile: vi.fn().mockResolvedValue("new") })} />);
    fireEvent.click(screen.getByRole("button", { name: /主连接/ }));
    await screen.findByRole("button", { name: "sora-2 设置" });
    expect(screen.getByText(/分类参考：视频生成（暂未接入）/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "sora-2 用于新对话" })).toBeDisabled();
    expect(screen.getByText(/分类参考：图片生成/)).toBeInTheDocument();
  });
  it("keeps optional settings collapsed and defaults to automatic protocol", () => {
    render(<ModelConnectionManager {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    expect(screen.getByLabelText("连接 Base URL")).toBeVisible();
    expect(screen.getByLabelText(/^连接 API Key/)).toBeVisible();
    expect(screen.getByText("更多设置（可选）").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByLabelText("连接接口协议")).toHaveValue("auto");
  });
  it("reveals saved and newly entered keys only on request and clears them when hidden or closed", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ api_key: "stored-test-key" });
    const page = props({ fetchJson });
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getAllByRole("button", { name: "编辑连接" })[0]);
    const input = screen.getByLabelText(/^连接 API Key/) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(fetchJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看 API Key" }));
    await waitFor(() => expect(input).toHaveValue("stored-test-key"));
    expect(input.type).toBe("text");
    expect(fetchJson).toHaveBeenCalledWith("/agent/model-connections/c1/reveal-key", { method: "POST" });
    fireEvent.click(screen.getByRole("button", { name: "隐藏 API Key" }));
    expect(input.type).toBe("password");
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "new-test-key" } });
    fireEvent.click(screen.getByRole("button", { name: "查看 API Key" }));
    expect(input.type).toBe("text");
    expect(fetchJson).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "取消编辑" }));
    fireEvent.click(screen.getAllByRole("button", { name: "编辑连接" })[0]);
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveValue("");
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveAttribute("type", "password");
  });

  it("ignores a delayed key response after changing the address", async () => {
    let resolveKey!: (result: { api_key: string }) => void;
    const fetchJson = vi.fn().mockImplementation(() => new Promise(resolve => { resolveKey = resolve; }));
    render(<ModelConnectionManager {...props({ fetchJson })} />);
    fireEvent.click(screen.getAllByRole("button", { name: "编辑连接" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "查看 API Key" }));
    fireEvent.change(screen.getByLabelText("连接 Base URL"), { target: { value: "https://changed.example.test" } });
    resolveKey({ api_key: "stored-test-key" });
    await waitFor(() => expect(screen.getByLabelText(/^连接 API Key/)).toHaveValue(""));
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveAttribute("type", "password");
    fireEvent.change(screen.getByLabelText("连接 Base URL"), { target: { value: "http://localhost:11434" } });
    fireEvent.click(screen.getByRole("button", { name: "查看 API Key" }));
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^连接 API Key/)).toHaveValue("");
  });
  it("keeps model controls collapsed and expands only the selected connection", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    expect(screen.queryByRole("button", { name: "first-model 设置" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /主连接/ }));
    expect(await screen.findByRole("button", { name: "first-model 设置" })).toBeVisible();
    expect(screen.queryByLabelText("思考程度")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /备用连接/ }));
    expect(screen.queryByRole("button", { name: "first-model 设置" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "second-model 设置" })).toBeVisible();
    expect(page.onMutate).not.toHaveBeenCalled();
  });

  it("shows only unique models returned by the service, without persisting its catalog", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ models: ["live-model", "live-model", "gpt-image-2"] });
    const page = props({ fetchJson });
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: /主连接/ }));
    expect(await screen.findByRole("button", { name: "live-model 设置" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "live-model 设置" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "first-model 设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gpt-image-2 设置" })).toBeVisible();
    expect(page.onMutate).not.toHaveBeenCalled();
    fetchJson.mockResolvedValue({ models: ["replacement-model"] });
    fireEvent.click(screen.getByRole("button", { name: "读取模型列表" }));
    await screen.findByRole("button", { name: "replacement-model 设置" });
    expect(screen.queryByRole("button", { name: "live-model 设置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gpt-image-2 设置" })).not.toBeInTheDocument();
    expect(page.onMutate).not.toHaveBeenCalled();
  });

  it("creates the shared service before choosing any model", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByLabelText("连接 Base URL"), { target: { value: "https://shared.example.test/v1" } });
    fireEvent.change(screen.getByLabelText(/^连接 API Key/), { target: { value: "synthetic-shared-key" } });
    expect(screen.getByRole("button", { name: "保存连接" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledOnce());
    expect(vi.mocked(page.onMutate).mock.calls[0][2]).toMatchObject({ model_base_url: "https://shared.example.test/v1", api_key: "synthetic-shared-key", model_protocol: "auto" });
    expect(vi.mocked(page.onMutate).mock.calls[0][2]?.model_name).toBeUndefined();
  });

  it("materializes only the chosen image model on the same connection", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ models: ["first-model", "gpt-image-2"] });
    const onEnsureProfile = vi.fn().mockResolvedValue("p-image");
    const page = props({ fetchJson, onEnsureProfile });
    const view = render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: /主连接/ }));
    fireEvent.click(await screen.findByRole("button", { name: "gpt-image-2 设置" }));
    await waitFor(() => expect(onEnsureProfile).toHaveBeenCalledWith("c1", "gpt-image-2", 3));
    view.rerender(<ModelConnectionManager {...page} catalog={{ ...catalog, profiles: [...catalog.profiles, { id: "p-image", connection_id: "c1", model_name: "gpt-image-2", enabled: true, revision: 1 }] }} />);
    expect(await screen.findByRole("region", { name: "gpt-image-2 设置" })).toBeVisible();
    expect(screen.getByText("图片模型不支持此设置")).toBeVisible();
    expect(page.onMutate).not.toHaveBeenCalled();
  });

  it("uses a service model only after explicit selection", async () => {
    const onEnsureProfile = vi.fn().mockResolvedValue("p-new");
    const page = props({ onEnsureProfile, fetchJson: vi.fn().mockResolvedValue({ models: ["new-service-model"] }) });
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: /主连接/ }));
    const use = await screen.findByRole("button", { name: "new-service-model 用于新对话" });
    expect(onEnsureProfile).not.toHaveBeenCalled();
    fireEvent.click(use);
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-default", "POST", { profile_id: "p-new" }));
    expect(onEnsureProfile).toHaveBeenCalledWith("c1", "new-service-model", 3);
    expect(page.onDefaultChanged).toHaveBeenCalledOnce();
  });

  it("saves image configuration through the shared connection form", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    fireEvent.change(screen.getByLabelText("连接 Base URL"), { target: { value: "https://cf.api.fan/v1" } });
    fireEvent.change(screen.getByLabelText("模型名称（可选）"), { target: { value: "gpt-image-2" } });
    expect(screen.getByText(/图片模型共用此连接/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("连接接口协议"), { target: { value: "images" } });
    fireEvent.change(screen.getByLabelText(/^连接 API Key/), { target: { value: "test-only-sora-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存连接" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-connections", "POST", expect.objectContaining({
      model_name: "gpt-image-2", model_protocol: "images", model_base_url: "https://cf.api.fan/v1", api_key: "test-only-sora-key"
    })));
  });

  it("adds a connection with three required fields and clears its credential after submission", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    expect(screen.getByRole("region", { name: "添加连接" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("连接 Base URL"), { target: { value: "https://new.example.test/v1" } });
    fireEvent.change(screen.getByLabelText(/^连接 API Key/), { target: { value: "test-only-new-key" } });
    fireEvent.change(screen.getByLabelText("模型名称（可选）"), { target: { value: "new-model" } });
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
    expect(screen.getByRole("region", { name: "编辑连接" })).toContainElement(await screen.findByText(/密钥输入已清除/));
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
    fireEvent.click(screen.getByText("手动添加模型"));
    await screen.findByRole("button", { name: "second-model 设置" });
    fireEvent.change(screen.getByLabelText("为 备用连接 添加模型"), { target: { value: "additional-model" } });
    fireEvent.click(screen.getByRole("button", { name: "添加模型" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-profiles", "POST", { connection_id: "c2", model_name: "additional-model" }));
    expect(page.onDefaultChanged).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "second-model 设置" }));
    moreOptions();
    fireEvent.click(screen.getByRole("button", { name: "设为默认" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-default", "POST", { profile_id: "p2" }));
    await waitFor(() => expect(page.onDefaultChanged).toHaveBeenCalledOnce());
  });

  it("protects the default connection and confirms archival inside the module", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    await openModelSettings("主连接", "first-model");
    moreOptions();
    expect(screen.getByRole("button", { name: "停用模型" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "关闭模型设置" }));
    fireEvent.click(screen.getByText("连接选项"));
    expect(screen.getByRole("button", { name: "停用连接" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /备用连接/ }));
    fireEvent.click(screen.getByText("连接选项"));
    fireEvent.click(screen.getByRole("button", { name: "停用连接" }));
    expect(page.onMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-connections/c2", "DELETE"));
  });

  it("uses an expected profile revision when disabling a nondefault model", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    await openModelSettings("备用连接", "second-model");
    moreOptions();
    fireEvent.click(screen.getByRole("button", { name: "停用模型" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-profiles/p2", "PATCH", { enabled: false, expected_revision: 2 }));
  });

  it("locks default changes while the main default form has an unsaved draft", async () => {
    render(<ModelConnectionManager {...props({ defaultLocked: true })} />);
    await openModelSettings("备用连接", "second-model");
    moreOptions();
    expect(screen.getByRole("button", { name: "设为默认" })).toBeDisabled();
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
  it("shows the protocol auto mode actually uses for a connection", async () => {
    const detected: ModelCatalog = { ...catalog, connections: [{ ...catalog.connections[0], detected_protocol: "responses" }, catalog.connections[1]] };
    render(<ModelConnectionManager {...props({ catalog: detected })} />);
    fireEvent.click(screen.getByRole("button", { name: /主连接/ }));
    fireEvent.click(screen.getByText("连接选项"));
    expect(screen.getByText("接口协议：自动 · 实际使用 OpenAI Responses API")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /备用连接/ }));
    fireEvent.click(screen.getByText("连接选项"));
    expect(screen.getByText("接口协议：OpenAI 兼容 Chat Completions")).toBeInTheDocument();
  });

  it("saves a per-model reasoning effort with the profile revision", async () => {
    const page = props();
    render(<ModelConnectionManager {...page} />);
    await openModelSettings("备用连接", "second-model");
    const select = screen.getByLabelText("思考程度");
    expect(select).toHaveValue("");
    expect(Array.from((select as HTMLSelectElement).options).map(option => option.textContent)).toEqual(["自动", "轻度", "标准", "深度"]);
    fireEvent.change(select, { target: { value: "high" } });
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-profiles/p2", "PATCH", { reasoning_effort: "high", expected_revision: 2 }));
    const withEffort: ModelCatalog = { ...catalog, profiles: [catalog.profiles[0], { ...catalog.profiles[1], reasoning_effort: "high", revision: 3 }] };
    cleanup();
    const next = props({ catalog: withEffort });
    render(<ModelConnectionManager {...next} />);
    await openModelSettings("备用连接", "second-model");
    fireEvent.change(screen.getByLabelText("思考程度"), { target: { value: "" } });
    await waitFor(() => expect(next.onMutate).toHaveBeenCalledWith("/agent/model-profiles/p2", "PATCH", { reasoning_effort: null, expected_revision: 3 }));
  });

  it("offers a one-click switch to the Responses API when the check rejects Chat Completions", async () => {
    let checks = 0;
    const fetchJson = vi.fn<ReturnType<typeof createApiClient>>().mockImplementation(async (path) => {
      if (String(path).endsWith("/discover")) return { models: ["second-model"] } as never;
      return (++checks === 1 ? { available: false, check_error_message: "模型不支持 Chat Completions 协议", suggested_protocol: "responses" } : { available: true, check_error_message: null, suggested_protocol: null }) as never;
    });
    const page = props({ fetchJson });
    const view = render(<ModelConnectionManager {...page} />);
    fireEvent.click(screen.getByRole("button", { name: /备用连接/ }));
    fireEvent.click(screen.getByText("检测与诊断"));
    fireEvent.click(screen.getByRole("button", { name: "检测此连接" }));
    expect(await screen.findByText("该模型不支持 Chat Completions，改用 OpenAI Responses API")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "改用 Responses 并重新检测" }));
    await waitFor(() => expect(page.onMutate).toHaveBeenCalledWith("/agent/model-connections/c2", "PATCH", { model_protocol: "responses", expected_revision: 2 }));
    const switched: ModelCatalog = { ...catalog, connections: [catalog.connections[0], { ...catalog.connections[1], model_protocol: "responses", revision: 3 }] };
    view.rerender(<ModelConnectionManager {...page} catalog={switched} />);
    await screen.findByText("连接检测成功。");
    expect(fetchJson.mock.calls.filter(([path]) => String(path).endsWith("/check"))).toHaveLength(2);
    expect(screen.queryByText("该模型不支持 Chat Completions，改用 OpenAI Responses API")).not.toBeInTheDocument();
  });

  it("shows the switch hint when model discovery carries a suggested protocol", async () => {
    const fetchJson = vi.fn<ReturnType<typeof createApiClient>>().mockRejectedValue(
      new ApiError("模型不支持 Chat Completions 协议", 400, 0, { message: "模型不支持 Chat Completions 协议", suggested_protocol: "responses" })
    );
    render(<ModelConnectionManager {...props({ fetchJson })} />);
    fireEvent.click(screen.getByRole("button", { name: /备用连接/ }));
    fireEvent.click(screen.getByRole("button", { name: "读取模型列表" }));
    expect(await screen.findByRole("button", { name: "改用 Responses 并重新检测" })).toBeInTheDocument();
  });
});
