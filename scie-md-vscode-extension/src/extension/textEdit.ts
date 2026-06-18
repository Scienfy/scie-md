export interface MinimalTextReplacement {
  start: number;
  end: number;
  text: string;
}

export function computeMinimalTextReplacement(before: string, after: string): MinimalTextReplacement | null {
  if (before === after) return null;

  let prefixLength = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (prefixLength < maxPrefix && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffix = Math.min(before.length - prefixLength, after.length - prefixLength);
  while (
    suffixLength < maxSuffix
    && before[before.length - 1 - suffixLength] === after[after.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    start: prefixLength,
    end: before.length - suffixLength,
    text: after.slice(prefixLength, after.length - suffixLength),
  };
}
