export function lineStartOffsets(text: string): number[] {
  const starts = [0];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\r') {
      if (text[index + 1] === '\n') {
        index += 2;
      } else {
        index += 1;
      }
      starts.push(index);
      continue;
    }
    if (char === '\n') {
      index += 1;
      starts.push(index);
      continue;
    }
    index += 1;
  }
  return starts;
}

export function offsetToLine(starts: number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(1, high + 1);
}
