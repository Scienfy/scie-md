export const visualPlaceholderMarkerPattern = /(?:SCIENFYVISUALBLOCK[A-Za-z0-9]+|SCIENFY_VISUAL_BLOCK_[A-Za-z0-9]+)/g;
export const escapedVisualPlaceholderMarkerPattern = /SCIENFY\\_VISUAL\\_BLOCK\\_[A-Za-z0-9]+/g;

export function extractVisualPlaceholderMarkers(markdown: string): Set<string> {
  const markers = new Set<string>();
  visualPlaceholderMarkerPattern.lastIndex = 0;
  escapedVisualPlaceholderMarkerPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = visualPlaceholderMarkerPattern.exec(markdown))) {
    markers.add(match[0]);
  }
  while ((match = escapedVisualPlaceholderMarkerPattern.exec(markdown))) {
    markers.add(match[0].replace(/\\_/g, '_'));
  }
  return markers;
}
