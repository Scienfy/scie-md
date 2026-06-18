import { describe, expect, it } from 'vitest';
import { createAcceptedHunkAuthorshipMarks, createInsertionAuthorshipMark, keepRecentAuthorshipMarks } from './authorship';

describe('authorship', () => {
  it('marks inserted pasted text without changing markdown', () => {
    const mark = createInsertionAuthorshipMark('Hello world', 'Hello AI world', 1000);

    expect(mark).toMatchObject({ start: 6, end: 9, label: 'AI paste' });
  });

  it('drops expired marks', () => {
    const marks = [
      { id: 'old', start: 0, end: 4, createdAt: 0, label: 'AI paste' },
      { id: 'fresh', start: 5, end: 9, createdAt: 1000, label: 'AI paste' },
    ];

    expect(keepRecentAuthorshipMarks(marks, 1500, 1000).map((mark) => mark.id)).toEqual(['fresh']);
  });

  it('marks accepted external hunks in the merged document', () => {
    const marks = createAcceptedHunkAuthorshipMarks(
      'Intro.\n\nExternal edit.\n',
      [{ id: 'hunk-1', afterLines: ['External edit.'] }],
      new Set(),
      1000,
      'Accepted external edit',
    );

    expect(marks).toMatchObject([{ start: 8, end: 22, label: 'Accepted external edit' }]);
  });

  it('uses hunk line positions instead of the first duplicate text match', () => {
    const document = 'Repeated edit.\n\nMiddle.\n\nRepeated edit.\n';
    const marks = createAcceptedHunkAuthorshipMarks(
      document,
      [{ id: 'hunk-1', afterStart: 4, afterLines: ['Repeated edit.'] }],
      new Set(),
      1000,
    );

    expect(marks).toMatchObject([{ start: 25, end: 39 }]);
  });

  it('skips ambiguous duplicate hunks instead of binding authorship to the wrong copy', () => {
    const document = 'Repeated edit.\n\nMiddle.\n\nRepeated edit.\n';
    const marks = createAcceptedHunkAuthorshipMarks(
      document,
      [{ id: 'hunk-1', afterLines: ['Repeated edit.'] }],
      new Set(),
      1000,
    );

    expect(marks).toEqual([]);
  });
});
