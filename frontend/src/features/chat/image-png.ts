export function pngFilename(filename: string): string {
  return `${filename.replace(/\.[^.]+$/, "") || "生成图片"}.png`;
}

export async function imageToPng(original: Blob): Promise<Blob> {
  if (original.type === "image/png") return original;
  const url = URL.createObjectURL(original);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取图片，请重试"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法导出 PNG");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG 导出失败，请重试")), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
