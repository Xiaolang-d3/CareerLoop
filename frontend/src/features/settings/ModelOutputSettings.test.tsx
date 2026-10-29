import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ModelOutputSettings } from "./ModelOutputSettings";

afterEach(cleanup);
const profile = { id: "custom", connection_id: "shared", model_name: "custom-alias", enabled: true, revision: 3 };
it("shows capability controls only while editing and saves output abilities separately", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  render(<ModelOutputSettings profile={profile} busy={false} onSave={onSave} />);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑能力" }));
  fireEvent.change(screen.getByLabelText("custom-alias 对话输出"), { target: { value: "supported" } });
  fireEvent.change(screen.getByLabelText("custom-alias 图片生成"), { target: { value: "unsupported" } });
  fireEvent.click(screen.getByRole("button", { name: "保存模型能力" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ chat: "supported", image_generation: "unsupported", video_generation: "unknown" }));
  await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
});
it("cancels without writing model capabilities", () => {
  const onSave = vi.fn();
  render(<ModelOutputSettings profile={profile} busy={false} onSave={onSave} />);
  fireEvent.click(screen.getByRole("button", { name: "编辑能力" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
