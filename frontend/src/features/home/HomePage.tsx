import { useEffect, useState } from "react";

function greetingPrefix(date: Date) {
  const hour = date.getHours();
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export function HomePage() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const updateTime = () => setNow(new Date());
    const timer = window.setInterval(updateTime, 1000);
    window.addEventListener("focus", updateTime);
    document.addEventListener("visibilitychange", updateTime);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateTime);
      document.removeEventListener("visibilitychange", updateTime);
    };
  }, []);

  return (
    <section className="home-page" aria-label="首页">
      <time className="home-time" aria-label="当前时间" dateTime={now.toISOString()}>
        {now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}
      </time>
      <h1 className="home-welcome">{greetingPrefix(now)}，欢迎回来</h1>
    </section>
  );
}
