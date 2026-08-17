import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectStudio } from "../../types";
import { ProjectStudioPage } from "./ProjectStudioPage";

const studio: ProjectStudio = {
  has_profile: true,
  has_resume: true,
  projects: [{
    id: "project-1",
    title: "实时语音链路",
    evidence: "麦克风 PCM 采集后做 Opus 编码。服务端走 ASR 再进 LLM。",
    gap_count: 0,
    briefing: {
      source_kind: "description",
      description: "",
      code_excerpt: "",
      situation: "实时语音转写与问答",
      core: "负责采集、编码和流式上行",
      stack: ["Opus", "ASR", "LLM"],
      layers: [
        { name: "客户端", steps: [{ title: "采集编码", detail: "麦克风 PCM 采集后做 Opus 编码" }] },
        { name: "服务端", steps: [{ title: "ASR 与 LLM", detail: "服务端走 ASR 再进 LLM" }] }
      ],
      mermaid: "",
      missing: [],
      generated_from: "rules",
      status: "ready"
    }
  }]
};

describe("ProjectStudioPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/project-studio/project-1/briefing") && init?.method === "POST") {
        const body = JSON.parse(String(init.body || "{}")) as { source_kind?: string; repo_url?: string };
        const kind = body.source_kind === "code" || body.source_kind === "repo" ? body.source_kind : "description";
        return new Response(JSON.stringify({
          ...studio,
          projects: [{
            ...studio.projects[0],
            briefing: {
              ...studio.projects[0].briefing,
              source_kind: kind,
              code_excerpt: kind === "code" ? "frontend/src/audio/capture.ts" : studio.projects[0].briefing.code_excerpt,
              repo_url: kind === "repo" ? body.repo_url : "",
              repo_owner: kind === "repo" ? "acme" : "",
              repo_name: kind === "repo" ? "voice" : "",
              layers: kind === "code" || kind === "repo"
                ? [{ name: "客户端", steps: [{ title: "capture", detail: "frontend/src/audio/capture.ts" }] }]
                : studio.projects[0].briefing.layers
            }
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(studio), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows stack, core, situation and the architecture chain", async () => {
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" onOpenProject={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "按材料梳理，不编造架构" })).toBeInTheDocument();
    expect(screen.getByLabelText("项目架构")).toHaveTextContent("客户端");
    expect(screen.getByLabelText("项目架构")).toHaveTextContent("服务端");
    expect(screen.getByText("项目情况").closest("article")).toHaveTextContent("实时语音转写与问答");
    expect(screen.getByText("项目核心").closest("article")).toHaveTextContent("负责采集、编码和流式上行");
    expect(screen.getByText("Opus")).toBeInTheDocument();
    expect(screen.getByText("ASR")).toBeInTheDocument();
  });

  it("rebuilds the chain from pasted code paths", async () => {
    const onOpenProject = vi.fn();
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" projectId="project-1" onOpenProject={onOpenProject} onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "实时语音链路" });
    fireEvent.click(screen.getByRole("button", { name: "从代码分析" }));
    fireEvent.change(screen.getByLabelText("代码或文件路径"), {
      target: { value: "frontend/src/audio/capture.ts" }
    });
    fireEvent.click(screen.getByRole("button", { name: "按当前材料重梳" }));

    await waitFor(() => {
      expect(screen.getByLabelText("项目架构")).toHaveTextContent("capture");
      expect(screen.getByLabelText("项目架构")).toHaveTextContent("frontend/src/audio/capture.ts");
    });
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => (
      String(input).endsWith("/project-studio/project-1/briefing") && String(init?.body || "").includes("code")
    ))).toBe(true);
  });

  it("rebuilds the chain from a pasted GitHub repo", async () => {
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" projectId="project-1" onOpenProject={vi.fn()} onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "实时语音链路" });
    fireEvent.click(screen.getByRole("button", { name: "从仓库分析" }));
    fireEvent.change(screen.getByLabelText("GitHub 仓库"), {
      target: { value: "https://github.com/acme/voice" }
    });
    fireEvent.click(screen.getByRole("button", { name: "按当前材料重梳" }));

    await waitFor(() => {
      expect(screen.getByLabelText("项目架构")).toHaveTextContent("capture");
      expect(screen.getByRole("link", { name: "acme/voice" })).toHaveAttribute("href", "https://github.com/acme/voice");
    });
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => (
      String(input).endsWith("/project-studio/project-1/briefing") && String(init?.body || "").includes("repo")
    ))).toBe(true);
  });
});
