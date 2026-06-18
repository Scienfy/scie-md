/// <reference types="vite/client" />

declare module 'markdown-it-deflist';
declare module 'markdown-it-footnote';
declare module 'markdown-it-task-lists';

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '*.css?raw' {
  const content: string;
  export default content;
}
