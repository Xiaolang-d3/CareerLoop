import { useState } from "react";
import { ExternalLink, Search, SlidersHorizontal } from "lucide-react";
import type { HomeMediaBoard, HomeModelBenchmarks } from "./types";
import { creatorColor } from "./benchmark-chart";

const METRICS = { elo: "Elo 评分", bba_score: "BBA 语音推理", fdb_score: "FDB 双向对话", tau_voice_score: "τ-Voice 任务表现", wer: "AA WER 词错误率" } as const;
type Metric = keyof typeof METRICS;
const value = (score: number | null | undefined, metric: Metric) => score == null ? "未提供" : metric === "wer"
  ? `${(score * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%`
  : score.toLocaleString("zh-CN", { maximumFractionDigits: metric === "elo" ? 1 : 3 });

export function HomeMediaBenchmarks({ category, data }: { category: HomeMediaBoard["category"]; data?: HomeModelBenchmarks }) {
  const [boardId, setBoardId] = useState("");
  const [speechMetric, setSpeechMetric] = useState<Metric>("bba_score");
  const [query, setQuery] = useState("");
  const [creator, setCreator] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const boards = data?.media?.filter(board => board.category === category) || [];
  const board = boards.find(board => board.id === boardId) || boards[0];
  const metric: Metric = board?.id === "speech-to-speech" ? speechMetric : board?.metric || "elo";
  const lowerIsBetter = metric === "wer";
  const models = board?.models || [];
  const creators = Array.from(new Set(models.map(model => model.creator))).sort();
  const matching = models.filter(model => (!creator || creator === model.creator) && `${model.name} ${model.creator}`.toLowerCase().includes(query.trim().toLowerCase()));
  const sorted = [...matching].sort((a, b) => a[metric] == null ? b[metric] == null ? a.name.localeCompare(b.name) : 1
    : b[metric] == null ? -1 : (lowerIsBetter ? a[metric]! - b[metric]! : b[metric]! - a[metric]!) || a.name.localeCompare(b.name));
  const measured = sorted.filter(model => model[metric] != null);
  const maximum = Math.max(...measured.map(model => Math.abs(model[metric]!)), 1e-9);
  const selected = sorted.find(model => model.id === selectedId);
  const collected = board?.collected_at ? new Date(board.collected_at) : null;
  const time = collected && Number.isFinite(collected.getTime()) ? collected.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
  const chooseBoard = (id: string) => { setBoardId(id); setQuery(""); setCreator(""); setSelectedId(null); setSpeechMetric("bba_score"); };
  const empty = data?.status === "unconfigured" ? "尚未配置官方评测数据源，请由应用管理员配置 Artificial Analysis API Key。"
    : board?.status === "error" ? board.error || "本榜单暂时无法更新。"
    : board?.status === "empty" ? "官方本次未返回此榜单的模型数据。" : "正在同步此类别的官方评测数据…";

  return <div className="home-media-benchmarks">
    {boards.length > 0 && <div className="home-chips home-media-subtypes" role="group" aria-label="评测任务">{boards.map(item => <button key={item.id} type="button" className={`home-benchmark-view${item.id === board?.id ? " on" : ""}`} aria-pressed={item.id === board?.id} onClick={() => chooseBoard(item.id)}>{item.label}</button>)}</div>}
    {models.length > 0 ? <>
      <div className="home-media-toolbar"><p>{METRICS[metric]} · {lowerIsBetter ? "越低越好" : "越高越好"} · {models.length} 个模型{matching.length !== models.length ? ` · 匹配 ${matching.length} 个` : ""}</p><div className="home-benchmark-tools"><label className="home-benchmark-search"><Search size={14} /><input aria-label="搜索媒体模型" placeholder="搜索模型" value={query} maxLength={100} onChange={event => setQuery(event.target.value)} /></label><details className="home-benchmark-filter" onKeyDown={event => { if (event.key === "Escape") event.currentTarget.open = false; }}><summary role="button" aria-label="媒体筛选设置"><SlidersHorizontal size={14} />筛选</summary><div className="home-benchmark-controls"><label>厂商<select aria-label="媒体评测厂商" value={creator} onChange={event => setCreator(event.target.value)}><option value="">全部厂商（{creators.length}）</option>{creators.map(name => <option key={name} value={name}>{name}</option>)}</select></label>{board.id === "speech-to-speech" && <label>评测指标<select aria-label="语音对话指标" value={speechMetric} onChange={event => setSpeechMetric(event.target.value as Metric)}>{(["bba_score", "fdb_score", "tau_voice_score"] as Metric[]).map(key => <option key={key} value={key}>{METRICS[key]}</option>)}</select></label>}</div></details></div></div>
      <div className="home-media-ranking-head"><span>按当前榜单评分排序</span><span>{METRICS[metric]}{metric === "elo" ? " / 95% CI" : ""}</span></div>
      <ol className="home-media-ranking" aria-label={`${board.label}模型榜单`}>{sorted.map(model => {
        const score = model[metric];
        const rank = score == null ? null : sorted.findIndex(other => other[metric] === score) + 1;
        return <li key={model.id}><button type="button" className={selectedId === model.id ? "selected" : ""} onClick={() => setSelectedId(model.id)} aria-label={`查看媒体模型：${model.name}，${METRICS[metric]} ${value(score, metric)}`}><span className="home-media-rank">{rank ?? "—"}</span><span className="home-media-name"><strong>{model.name}</strong><small><i style={{ background: creatorColor(model.creator) }} />{model.creator}</small></span><span className="home-media-score-track" aria-hidden="true"><span style={{ width: `${score == null ? 0 : Math.max(0, score) / maximum * 100}%`, background: creatorColor(model.creator) }} /></span><span className="home-media-score"><strong>{value(score, metric)}</strong>{metric === "elo" && <small>{model.ci_95 == null ? "CI 未提供" : `± ${value(model.ci_95, "elo")}`}</small>}</span></button></li>;
      })}</ol>
      {!matching.length && <p className="home-benchmark-note">没有匹配的模型，可清空搜索或选择全部厂商。</p>}
      {selected && <div className="home-benchmark-detail" aria-live="polite"><><a href={selected.url} target="_blank" rel="noreferrer">{selected.name}<ExternalLink size={12} /></a><span>{selected.creator} · {METRICS[metric]} {value(selected[metric], metric)}{metric === "elo" && selected.ci_95 != null ? ` · 95% CI ± ${value(selected.ci_95, "elo")}` : ""}</span></></div>}
      <details className="home-benchmark-explainer"><summary>指标说明</summary><p className="home-benchmark-note">{metric === "elo" ? "Elo 反映当前任务中的用户偏好，不同榜单的分数不能直接比较。CI 是 95% 置信区间，区间重叠时不宜只凭名次判断差异。" : lowerIsBetter ? "词错误率越低，语音转写错误越少；缺少测量结果的型号不参与排序。" : "各项语音评测分别比较，不合并为总分；缺少测量结果的型号保留并显示“未提供”。"} 当前公开数据未提供此类别的价格与速度。</p></details>
      {board.status === "error" && <p className="home-digest-warning" role="status">{board.error} · 继续显示上次快照</p>}
    </> : <div className="home-benchmark-empty" role="status"><p>{empty}</p></div>}
    <div className="home-benchmark-provenance"><a href={board?.source_url || "https://artificialanalysis.ai/"} target="_blank" rel="noreferrer">官方榜单 <ExternalLink size={12} /></a><a href="https://artificialanalysis.ai/data-api/docs/reference" target="_blank" rel="noreferrer">Data API 文档</a><span>{time ? `采集于 ${time} · 每 6 小时更新` : "尚无已采集数据"}</span></div>
  </div>;
}
