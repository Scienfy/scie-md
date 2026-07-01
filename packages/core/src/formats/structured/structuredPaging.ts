export interface StructuredPreviewPageInfo {
  itemLabel: string;
  totalItems: number;
  parsedItems: number;
  pageSize: number;
  pageCount: number;
  previewTruncated: boolean;
}

export interface StructuredPreviewPageWindow {
  pageIndex: number;
  pageCount: number;
  startIndex: number;
  endIndex: number;
  startOrdinal: number;
  endOrdinal: number;
  empty: boolean;
}

export const STRUCTURED_PREVIEW_DEFAULT_PAGE_SIZE = 50;

export function createStructuredPreviewPageInfo({
  itemLabel,
  totalItems,
  parsedItems,
  pageSize = STRUCTURED_PREVIEW_DEFAULT_PAGE_SIZE,
}: {
  itemLabel: string;
  totalItems: number;
  parsedItems: number;
  pageSize?: number;
}): StructuredPreviewPageInfo {
  const safeTotal = Math.max(0, Math.floor(totalItems));
  const safeParsed = Math.max(0, Math.min(safeTotal, Math.floor(parsedItems)));
  const safePageSize = Math.max(1, Math.floor(pageSize));
  return {
    itemLabel,
    totalItems: safeTotal,
    parsedItems: safeParsed,
    pageSize: safePageSize,
    pageCount: Math.max(1, Math.ceil(safeParsed / safePageSize)),
    previewTruncated: safeParsed < safeTotal,
  };
}

export function structuredPreviewPageWindow(
  pageInfo: StructuredPreviewPageInfo,
  requestedPageIndex: number,
): StructuredPreviewPageWindow {
  const pageCount = Math.max(1, pageInfo.pageCount);
  const pageIndex = Math.max(0, Math.min(pageCount - 1, Math.floor(requestedPageIndex)));
  const startIndex = Math.min(pageInfo.parsedItems, pageIndex * pageInfo.pageSize);
  const endIndex = Math.min(pageInfo.parsedItems, startIndex + pageInfo.pageSize);
  const empty = endIndex <= startIndex;
  return {
    pageIndex,
    pageCount,
    startIndex,
    endIndex,
    startOrdinal: empty ? 0 : startIndex + 1,
    endOrdinal: empty ? 0 : endIndex,
    empty,
  };
}

export function structuredPreviewPageItems<T>(
  items: readonly T[],
  pageInfo: StructuredPreviewPageInfo,
  requestedPageIndex: number,
): { window: StructuredPreviewPageWindow; items: T[] } {
  const window = structuredPreviewPageWindow(pageInfo, requestedPageIndex);
  return {
    window,
    items: items.slice(window.startIndex, window.endIndex),
  };
}
