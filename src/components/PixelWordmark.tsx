import { ADVANCE, GLYPH_H, textPixels, textWidth } from "@/lib/city/font";

/**
 * The wordmark: the bitmap font extruded into blocks, the way the
 * Minecraft logo is built — a face colour, a dark side dropping down and
 * to the right, an outline. Pure SVG from integers, so it renders the
 * same on the server and in the browser.
 */
export function PixelWordmark({
  text = "PIXEL MARKET",
  height = 28,
  depth = 2,
  colors = ["#ffffff", "#3fd46a"],
  className = "",
}: {
  text?: string;
  height?: number;
  depth?: number;
  /** Face colour per word. */
  colors?: string[];
  className?: string;
}) {
  const words = text.split(" ");
  const w = textWidth(text) + depth + 2;
  const h = GLYPH_H + depth + 2;
  const face: string[] = [];
  const side: string[] = [];
  const outline: string[] = [];
  let cursor = 0;
  words.forEach((word, wi) => {
    const px = textPixels(word);
    const color = colors[wi % colors.length];
    const f: string[] = [];
    for (const [x, y] of px) {
      const X = x + cursor + 1;
      const Y = y + 1;
      f.push(`M${X} ${Y}h1v1h-1z`);
      outline.push(`M${X - 1} ${Y - 1}h3v3h-3z`);
      for (let d = 1; d <= depth; d++) {
        side.push(`M${X + d} ${Y + d}h1v1h-1z`);
        outline.push(`M${X + d - 1} ${Y + d - 1}h3v3h-3z`);
      }
    }
    face.push(`<path fill="${color}" d="${f.join("")}"/>`);
    cursor += (word.length + 1) * ADVANCE;
  });
  const scale = height / h;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w * scale}
      height={height}
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label={text}
      dangerouslySetInnerHTML={{
        __html: `<path fill="#0c0e12" d="${outline.join("")}"/><path fill="#2a2f3a" d="${side.join("")}"/>${face.join("")}`,
      }}
    />
  );
}
