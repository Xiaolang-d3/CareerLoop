export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  const revoke = URL.revokeObjectURL.bind(URL);
  window.setTimeout(() => revoke(url), 1000);
}

export function downloadText(content: string, filename: string, mime = "text/plain") {
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), filename);
}

export function codeFilename(language: string) {
  const extensions: Record<string, string> = { python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx", json: "json", html: "html", css: "css", sql: "sql", bash: "sh", shell: "sh", sh: "sh", yaml: "yaml", yml: "yml", go: "go", rust: "rs", java: "java", c: "c", cpp: "cpp", markdown: "md", md: "md", mermaid: "mmd", xml: "xml", toml: "toml" };
  return `代码.${extensions[language.toLowerCase()] || "txt"}`;
}

export function markdownToText(markdown: string): string {
  // Transform prose only; code fences are preserved byte-for-byte inside them.
  let fence = "";
  return markdown.split("\n").map(line => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (match && (!fence || (match[1][0] === fence[0] && match[1].length >= fence.length))) {
      fence = fence ? "" : match[1];
      return "";
    }
    if (fence) return line;
    return line.replace(/^ {0,3}#{1,6}\s+/, "").replace(/^>\s?/, "")
      .replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, "$1（$2）")
      .replace(/(\*\*|__|~~)(.*?)\1/g, "$2").replace(/`([^`]+)`/g, "$1");
  }).join("\n");
}
