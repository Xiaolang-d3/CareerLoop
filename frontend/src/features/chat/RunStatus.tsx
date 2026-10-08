import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

export function RunStatus({ title, task }: { title: string; task?: string }) {
  const [startedAt] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return <div className="chat-run-status"><span role="status"><LoaderCircle size={14} className="spinning" /><strong>{title}</strong>{task ? <span title={task}>{task}</span> : null}</span>{seconds >= 10 ? <small aria-label="本次页面等待时间">已等待 {seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`}</small> : null}</div>;
}
