import { expect, it } from "vitest";
import { VoiceDraftEditor } from "./voiceDraft";

const update = (text: string, revision = 1, segmentId = 0, final = false) => ({ text, revision, segmentId, final });
const at = (start: number) => ({ start, end: start });

it("revises a speech preview in place, then inserts the next sentence without duplicate Chinese text", () => {
  const editor = new VoiceDraftEditor();
  expect(editor.apply("计划：", update("边说边出自"), at(3))?.text).toBe("计划：边说边出自");
  expect(editor.apply("计划：边说边出自", update("边说边出字。", 2, 0, true), at(8))?.text).toBe("计划：边说边出字。");
  expect(editor.apply("计划：边说边出字。", update("停止后不改写。", 1, 1), at(9))?.text).toBe("计划：边说边出字。停止后不改写。");
});

it("preserves manual edits before and after the speech range", () => {
  const editor = new VoiceDraftEditor();
  editor.apply("前后", update("初稿"), at(1));
  editor.observe("新增前初稿后");
  editor.observe("新增前初稿后补充");
  expect(editor.apply("新增前初稿后补充", update("定稿", 2), at(8))?.text).toBe("新增前定稿后补充");
});

it("freezes a manually corrected or deleted preview instead of overwriting it", () => {
  const editor = new VoiceDraftEditor();
  editor.apply("", update("登登"), at(0));
  expect(editor.apply("灯灯", update("登登。", 2, 0, true), at(2))).toBeNull();
  expect(editor.apply("灯灯", update("你好", 1, 1), at(2))?.text).toBe("灯灯你好");
  expect(editor.apply("灯灯", update("你好。", 2, 1, true), at(2))).toBeNull();
});

it("keeps user insertions on both edges and separates adjacent English words", () => {
  const editor = new VoiceDraftEditor();
  editor.apply("hello", update("world"), at(5));
  expect(editor.apply("hello world!", update("world.", 2), at(12))?.text).toBe("hello world.!");
});

it("ignores stale revisions and segments and never replaces a selected draft", () => {
  const editor = new VoiceDraftEditor();
  expect(editor.apply("已有文字", update("语音", 2, 1), { start: 0, end: 4 })?.text).toBe("已有文字语音");
  expect(editor.apply("已有文字语音", update("迟到", 1, 1), at(6))).toBeNull();
  expect(editor.apply("已有文字语音", update("上一段", 3, 0), at(6))).toBeNull();
});

it("freezes a confirmed sentence even if a later revision arrives", () => {
  const editor = new VoiceDraftEditor();
  editor.apply("", update("确定。", 1, 0, true), at(0));
  expect(editor.apply("确定。", update("不应改写", 2), at(3))).toBeNull();
});
