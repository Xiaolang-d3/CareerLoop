import { useState } from "react";
import "./creation.css";

type Props = { busy: boolean; onGenerate: (prompt: string) => void; onOpenLibrary: () => void; onOpenResume: () => void };
const formats = ["写文章", "总结", "改写", "PPT 大纲"];
export function CreationPage({ busy, onGenerate, onOpenLibrary, onOpenResume }: Props) {
  const [format, setFormat] = useState(formats[0]);
  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState("专业清晰");
  const [length, setLength] = useState("中篇");
  return <section className="creation-page">
    <header><h2>内容创作</h2><p>基于你的知识，辅助写作与创作。</p></header>
    <form className="creation-form" onSubmit={(event) => { event.preventDefault(); if (!brief.trim() || busy) return; onGenerate(`请帮我${format}。\n创作要求：${brief.trim()}\n风格：${tone}；篇幅：${length}。\n请参考知识库中与本次任务相关的已确认信息；如果材料不足，请说明，不要编造。`); }}>
      <div className="creation-tabs" role="group" aria-label="创作类型">{formats.map((item) => <button type="button" key={item} aria-pressed={format === item} onClick={() => setFormat(item)}>{item}</button>)}</div>
      <label>创作要求<textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：基于我的读书笔记，写一篇关于持续学习的文章。改写或总结时，也可以在这里粘贴原文。" rows={8} /></label>
      <p>参考知识库中的相关资料，也可以在要求中指定来源。</p>
      <button type="button" className="ui-button" onClick={onOpenLibrary}>查看我的知识库</button>
      <div className="creation-options"><label>风格<select value={tone} onChange={(event) => setTone(event.target.value)}>{["专业清晰", "轻松自然", "简洁直接"].map((item) => <option key={item}>{item}</option>)}</select></label><label>篇幅<select value={length} onChange={(event) => setLength(event.target.value)}>{["短篇", "中篇", "长篇"].map((item) => <option key={item}>{item}</option>)}</select></label></div>
      <button className="ui-button is-primary" disabled={busy || !brief.trim()} type="submit">{busy ? "正在准备或处理任务…" : "生成内容"}</button>
      <p>生成时会打开 AI 助手，展示处理过程与结果，可继续追问和修改。</p>
    </form>
    <footer><span>专业创作</span><button type="button" className="ui-button" onClick={onOpenResume}>简历编辑与导出</button></footer>
  </section>;
}
