export function chunkText(text: string, size = 1200): Array<{
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
}> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= size) {
    return [{ index: 0, content: trimmed, charStart: 0, charEnd: trimmed.length }];
  }

  const chunks: Array<{
    index: number;
    content: string;
    charStart: number;
    charEnd: number;
  }> = [];
  let pos = 0;
  let index = 0;
  while (pos < trimmed.length) {
    const end = Math.min(pos + size, trimmed.length);
    chunks.push({
      index,
      content: trimmed.slice(pos, end),
      charStart: pos,
      charEnd: end,
    });
    index += 1;
    pos = end;
  }
  return chunks;
}
