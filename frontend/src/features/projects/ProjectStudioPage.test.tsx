import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectStudio } from "../../types";
import { ProjectStudioPage } from "./ProjectStudioPage";

const studio: ProjectStudio = {
  has_profile: true,
  has_resume: true,
  projects: [{
    id: "project-1",
    title: "实时语音链路 https://play.example.com/voice",
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

  it("uses a project index instead of a permanent project sidebar", async () => {
    const onOpenProject = vi.fn();
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" onOpenProject={onOpenProject} onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "从已确认项目继续梳理" })).toBeInTheDocument();
    expect(screen.queryByText("https://play.example.com/voice")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /实时语音链路/ }));
    expect(onOpenProject).toHaveBeenCalledWith("project-1", "overview");
  });

  it("shows a concise overview with clean title and four child routes", async () => {
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" projectId="project-1" page="overview" onOpenProject={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "实时语音链路" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看原项目" })).toHaveAttribute("href", "https://play.example.com/voice");
    expect(screen.queryByLabelText("项目架构")).not.toBeInTheDocument();
    expect(screen.getByText("项目情况").closest("article")).toHaveTextContent("实时语音转写与问答");
    expect(screen.getByText("我的职责").closest("article")).toHaveTextContent("负责采集、编码和流式上行");
    expect(screen.getByText("Opus")).toBeInTheDocument();
    expect(screen.getByText("ASR")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "项目工作区" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "架构拆解" })).toHaveAttribute("href", "#/project/project-1/architecture");
    expect(screen.getByRole("link", { name: "材料与分析" })).toHaveAttribute("href", "#/project/project-1/materials");
  });

  it("keeps the architecture on its own child page", async () => {
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" projectId="project-1" page="architecture" onOpenProject={vi.fn()} onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "从材料确认的完整链路" });
    expect(screen.getByLabelText("项目架构")).toHaveTextContent("客户端");
    expect(screen.getByLabelText("项目架构")).toHaveTextContent("服务端");
    expect(screen.queryByText("项目情况")).not.toBeInTheDocument();
  });

  it("rebuilds the chain from pasted code paths", async () => {
    const onOpenProject = vi.fn();
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" projectId="project-1" page="materials" onOpenProject={onOpenProject} onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "实时语音链路" });
    await screen.findByLabelText("项目描述");
    fireEvent.click(screen.getByRole("tab", { name: "代码与文件" }));
    fireEvent.change(screen.getByLabelText("代码或文件路径"), {
      target: { value: "frontend/src/audio/capture.ts" }
    });
    fireEvent.click(screen.getByRole("button", { name: "根据当前材料更新分析" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "代码与文件" })).toHaveAttribute("aria-selected", "true");
    });
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => (
      String(input).endsWith("/project-studio/project-1/briefing") && String(init?.body || "").includes("code")
    ))).toBe(true);
  });

  it("rebuilds the chain from a pasted GitHub repo", async () => {
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" projectId="project-1" page="materials" onOpenProject={vi.fn()} onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "实时语音链路" });
    await screen.findByLabelText("项目描述");
    fireEvent.click(screen.getByRole("tab", { name: "GitHub 仓库" }));
    fireEvent.change(screen.getByLabelText("GitHub 仓库"), {
      target: { value: "https://github.com/acme/voice" }
    });
    fireEvent.click(screen.getByRole("button", { name: "根据当前材料更新分析" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "GitHub 仓库" })).toHaveAttribute("aria-selected", "true");
    });
    expect(vi.mocked(fetch).mock.calls.some(([input, init]) => (
      String(input).endsWith("/project-studio/project-1/briefing") && String(init?.body || "").includes("repo")
    ))).toBe(true);
  });

  it("opens the complete interview preparation from the interview child page", async () => {
    const onOpenInterview = vi.fn();
    render(<ProjectStudioPage apiBase="http://localhost:8000" accessToken="token" projectId="project-1" page="interview" onOpenProject={vi.fn()} onOpenInterview={onOpenInterview} onOpenProfile={vi.fn()} />);

    await screen.findByRole("heading", { name: "只围绕现有材料组织表达" });
    fireEvent.click(screen.getByRole("button", { name: "进入完整面试准备" }));
    expect(onOpenInterview).toHaveBeenCalledWith("project-1");
  });
});
