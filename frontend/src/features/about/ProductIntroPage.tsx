import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import "./product-intro.css";

export function ProductIntroPage({ returnHash, signedIn = false }: { returnHash: string; signedIn?: boolean }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const actionLabel = signedIn ? "继续使用 CareerLoop" : "登录 / 注册";

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "产品介绍｜CareerLoop";
    headingRef.current?.focus({ preventScroll: true });
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <main className="product-intro-page">
      <div className="product-intro-container">
        <header className="product-intro-header">
          <a className="product-intro-brand" href={returnHash} aria-label="CareerLoop 入口">
            <img src="/careerloop-mark-v2.png" alt="" draggable={false} />
            <span>CAREERLOOP</span>
          </a>
          <a className="product-intro-back" href={returnHash}><ArrowLeft size={16} aria-hidden="true" />{signedIn ? "返回应用" : "返回登录"}</a>
        </header>
        <section className="product-intro-hero" aria-labelledby="product-intro-title">
          <p className="product-intro-kicker">让资料在每次对话中持续发挥作用</p>
          <h1 id="product-intro-title" ref={headingRef} tabIndex={-1}>从真实资料出发，<br />完成分析与创作。</h1>
          <p className="product-intro-description">CareerLoop 帮你整理长期资料，在对话中完成搜索、分析和内容生成，并把结果沉淀到你的本地知识库。</p>
          <ol className="product-intro-steps" aria-label="使用流程">
            <li>整理资料</li><li>开始对话</li><li>沉淀成果</li>
          </ol>
          <a className="product-intro-action" href={returnHash}>{actionLabel}<ArrowRight size={18} aria-hidden="true" /></a>
        </section>
        <ul className="product-intro-features" aria-label="产品特点">
          <li><strong>有据可循</strong><p>分析和内容都能回到你提供的资料。</p></li>
          <li><strong>始终可控</strong><p>联网研究和资料使用均由你决定。</p></li>
          <li><strong>持续积累</strong><p>确认过的信息可以在后续任务中复用。</p></li>
        </ul>
        <footer className="product-intro-footer">本地账户 · 资料留在本机 · 联网研究由你决定</footer>
      </div>
    </main>
  );
}
