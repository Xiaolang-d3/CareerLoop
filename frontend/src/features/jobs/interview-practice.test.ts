import { afterEach, describe, expect, it } from "vitest";
import {
  hasStartedInterviewPractice,
  interviewPracticeProgress,
  loadInterviewPractice,
  saveInterviewPractice
} from "./interview-practice";

afterEach(() => {
  localStorage.clear();
});

describe("interview practice storage", () => {
  it("keeps answers and practiced ids for the current kit", () => {
    saveInterviewPractice(31, {
      answers: { q1: "我负责调度" },
      practiced: ["q1"],
      currentId: "q1"
    });

    expect(loadInterviewPractice(31, ["q1", "q2"])).toEqual({
      answers: { q1: "我负责调度" },
      practiced: ["q1"],
      currentId: "q1"
    });
  });

  it("drops stale question ids after a kit is regenerated", () => {
    saveInterviewPractice(31, {
      answers: { old: "过期" },
      practiced: ["old"],
      currentId: "old"
    });

    expect(loadInterviewPractice(31, ["q1"])).toEqual({
      answers: {},
      practiced: [],
      currentId: "q1"
    });
  });

  it("points an unfinished drill at the next unpracticed question", () => {
    const progress = interviewPracticeProgress({
      answers: { q1: "我负责调度" },
      practiced: ["q1"],
      currentId: "q1"
    }, ["q1", "q2"]);

    expect(progress).toMatchObject({
      started: true,
      complete: false,
      practicedCount: 1,
      nextId: "q2"
    });
    expect(hasStartedInterviewPractice(31)).toBe(false);
    saveInterviewPractice(31, {
      answers: { q1: "我负责调度" },
      practiced: ["q1"],
      currentId: "q1"
    });
    expect(hasStartedInterviewPractice(31)).toBe(true);
  });
});
