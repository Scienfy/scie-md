import tokensCss from './app.tokens.css?raw';
import shellCss from './app.shell.css?raw';
import navigationCss from './app.navigation.css?raw';
import editorCss from './app.editor.css?raw';
import visualEditorCss from './app.visual-editor.css?raw';
import editorInlineCss from './app.editor-inline.css?raw';
import editorAnnotationsCss from './app.editor-annotations.css?raw';
import editorVariantsCss from './app.editor-variants.css?raw';
import visualAtomsCss from './app.visual-atoms.css?raw';
import directiveCardsCss from './app.directive-cards.css?raw';
import directiveRenderedCss from './app.directive-rendered.css?raw';
import directiveThemeOverridesCss from './app.directive-theme-overrides.css?raw';
import directiveEditorsCss from './app.directive-editors.css?raw';
import sourceEditorCss from './app.source-editor.css?raw';
import panelsCss from './app.panels.css?raw';
import dialogsCss from './app.dialogs.css?raw';
import reviewCss from './app.review.css?raw';
import feedbackCss from './app.feedback.css?raw';
import exportCss from './app.export.css?raw';

export const appCssModuleOrder = [
  'app.tokens.css',
  'app.shell.css',
  'app.navigation.css',
  'app.editor.css',
  'app.visual-editor.css',
  'app.editor-inline.css',
  'app.editor-annotations.css',
  'app.editor-variants.css',
  'app.visual-atoms.css',
  'app.directive-cards.css',
  'app.directive-rendered.css',
  'app.directive-theme-overrides.css',
  'app.directive-editors.css',
  'app.source-editor.css',
  'app.panels.css',
  'app.dialogs.css',
  'app.review.css',
  'app.feedback.css',
  'app.export.css',
] as const;

export const appCss = [
  tokensCss,
  shellCss,
  navigationCss,
  editorCss,
  visualEditorCss,
  editorInlineCss,
  editorAnnotationsCss,
  editorVariantsCss,
  visualAtomsCss,
  directiveCardsCss,
  directiveRenderedCss,
  directiveThemeOverridesCss,
  directiveEditorsCss,
  sourceEditorCss,
  panelsCss,
  dialogsCss,
  reviewCss,
  feedbackCss,
  exportCss,
].join('\n');
