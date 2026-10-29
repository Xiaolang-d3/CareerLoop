import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createApiClient } from "../../api/client";
import type { ModelCatalog } from "../../types";
import { ModelRoutingPanel } from "./ModelRoutingPanel";

type Client = ReturnType<typeof createApiClient>;
const initial = { version: 1, roles: {}, strict_capabilities: false };
const catalog: ModelCatalog = {
  connections: [{ id: "c", name: "测试服务", model_base_url: "https://test.example.test", model_protocol: "openai", api_key_configured: true, enabled: true, revision: 1 }],
  profiles: [{ id: "p", connection_id: "c", model_name: "测试模型", enabled: true, revision: 1 }], default_profile_id: "p"
};
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve }; }
afterEach(cleanup);

async function open() {
  fireEvent.click(screen.getByRole("button", { name: "配置分工" }));
  await screen.findByRole("combobox", { name: "执行回答模型" });
}

describe("ModelRoutingPanel", () => {
  it("retains a historical role without offering other-service models as new choices", async () => {
    const other = { id: "old", connection_id: "historical", model_name: "历史模型", enabled: true, revision: 1 };
    const singleService: ModelCatalog = { ...catalog, service_connection_id: "c", connections: [...catalog.connections, { ...catalog.connections[0], id: "historical", name: "旧服务" }], profiles: [...catalog.profiles, other] };
    const fetchJson = vi.fn().mockResolvedValue({ ...initial, roles: { plan: "old" } });
    render(<ModelRoutingPanel fetchJson={fetchJson as unknown as Client} catalog={singleService} onApplied={vi.fn()} />);
    await open();
    expect(screen.getByRole("combobox", { name: "任务规划模型" })).toHaveValue("old");
    expect(screen.getAllByRole("option", { name: "历史模型（历史服务配置）" })).toHaveLength(1);
    expect(screen.getByRole("option", { name: "历史模型（历史服务配置）" })).toBeDisabled();
    expect(screen.queryByRole("option", { name: "旧服务 / 历史模型" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("历史服务配置");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "保存分工" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "任务规划模型" }), { target: { value: "p" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存分工" })).toBeEnabled();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it("loads only on demand and saves the three roles with version checking", async () => {
    const fetchJson = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, version: 2, roles: { plan: "p", execute: "p" } });
    const onApplied = vi.fn().mockResolvedValue(undefined);
    render(<ModelRoutingPanel fetchJson={fetchJson as unknown as Client} catalog={catalog} onApplied={onApplied} />);
    expect(fetchJson).not.toHaveBeenCalled();
    await open();
    fireEvent.change(screen.getByRole("combobox", { name: "任务规划模型" }), { target: { value: "p" } });
    fireEvent.change(screen.getByRole("combobox", { name: "执行回答模型" }), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "保存分工" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchJson.mock.calls[1][1].body)).toEqual({ roles: { plan: "p", execute: "p" }, strict_capabilities: false, expected_version: 1 });
    expect(screen.getByRole("status")).toHaveTextContent("从新任务开始生效");
    expect(screen.getByRole("button", { name: "保存分工" })).toBeDisabled();
  });

  it("keeps conflicting drafts and lets the user explicitly reload the latest policy", async () => {
    const fetchJson = vi.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(Object.assign(new Error("conflict"), { status: 409 })).mockResolvedValueOnce({ ...initial, version: 3 });
    render(<ModelRoutingPanel fetchJson={fetchJson as unknown as Client} catalog={catalog} onApplied={vi.fn()} />);
    await open();
    fireEvent.change(screen.getByRole("combobox", { name: "任务规划模型" }), { target: { value: "p" } });
    fireEvent.click(screen.getByRole("button", { name: "保存分工" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("草稿已保留");
    expect(screen.getByRole("combobox", { name: "任务规划模型" })).toHaveValue("p");
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "任务规划模型" })).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prevents duplicate saves and freezes the draft until completion", async () => {
    const pending = deferred<typeof initial>();
    const fetchJson = vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(pending.promise);
    render(<ModelRoutingPanel fetchJson={fetchJson as unknown as Client} catalog={catalog} onApplied={vi.fn()} />);
    await open();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "保存分工" }));
    expect(screen.getByRole("combobox", { name: "执行回答模型" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "正在保存…" }));
    expect(fetchJson).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve({ ...initial, version: 2 }));
    expect(screen.getByRole("combobox", { name: "执行回答模型" })).toBeEnabled();
  });

  it("does not describe a committed policy as failed when refreshing the current model fails", async () => {
    const fetchJson = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, version: 2, strict_capabilities: true });
    render(<ModelRoutingPanel fetchJson={fetchJson as unknown as Client} catalog={catalog} onApplied={vi.fn().mockRejectedValue(new Error("refresh failed"))} />);
    await open();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "保存分工" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存，当前模型显示尚未刷新"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks disabled profiles and displays the retained selection", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ ...initial, roles: { plan: "disabled" } });
    render(<ModelRoutingPanel fetchJson={fetchJson as unknown as Client} catalog={catalog} onApplied={vi.fn()} />);
    await open();
    expect(screen.getByRole("combobox", { name: "任务规划模型" })).toHaveValue("disabled");
    expect(screen.getByRole("alert")).toHaveTextContent("已停用或不存在");
    expect(screen.getByRole("button", { name: "保存分工" })).toBeDisabled();
  });

  it("aborts unmounted requests and ignores late success", async () => {
    const pending = deferred<typeof initial>();
    const fetchJson = vi.fn().mockResolvedValueOnce(initial).mockReturnValueOnce(pending.promise);
    const onApplied = vi.fn();
    const view = render(<ModelRoutingPanel fetchJson={fetchJson as unknown as Client} catalog={catalog} onApplied={onApplied} />);
    await open();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "保存分工" }));
    const signal = fetchJson.mock.calls[1][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ ...initial, version: 2 }));
    expect(onApplied).not.toHaveBeenCalled();
  });
});
