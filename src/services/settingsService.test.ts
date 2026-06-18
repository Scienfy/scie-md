import { beforeEach, describe, expect, it } from 'vitest';
import { forgetRecentFile, loadSettings, rememberRecentFile, updateSettings } from './settingsService';

describe('settingsService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('remembers at most fifteen recent files in most-recent-first order', () => {
    for (let index = 0; index < 17; index += 1) {
      rememberRecentFile(`/tmp/${index}.md`);
    }

    expect(loadSettings().recentFiles).toEqual([
      '/tmp/16.md',
      '/tmp/15.md',
      '/tmp/14.md',
      '/tmp/13.md',
      '/tmp/12.md',
      '/tmp/11.md',
      '/tmp/10.md',
      '/tmp/9.md',
      '/tmp/8.md',
      '/tmp/7.md',
      '/tmp/6.md',
      '/tmp/5.md',
      '/tmp/4.md',
      '/tmp/3.md',
      '/tmp/2.md',
    ]);
  });

  it('starts first-run users in the Scienfy writing defaults', () => {
    expect(loadSettings()).toMatchObject({
      themeMode: 'dark',
      visualStyle: 'scienfy',
      sidebarView: 'outline',
      sidebarWidth: 360,
      documentType: 'report',
      onboardingComplete: false,
      inkscapePath: null,
    });
  });

  it('forgets missing recent files', () => {
    rememberRecentFile('/tmp/a.md');
    rememberRecentFile('/tmp/b.md');
    forgetRecentFile('/tmp/a.md');

    expect(loadSettings().recentFiles).toEqual(['/tmp/b.md']);
  });

  it('persists display settings without losing recent files', () => {
    rememberRecentFile('/tmp/a.md');
    updateSettings({
      themeMode: 'sepia',
      fontScale: 1.2,
      visualStyle: 'technical-code',
      outlineOpen: false,
      sidebarWidth: 420,
      sidebarView: 'files',
      explorerRootPath: '/tmp',
      inspectorOpen: false,
      authorshipVisible: false,
      focusMode: true,
      documentType: 'report',
      onboardingComplete: true,
      inkscapePath: 'C:\\Program Files\\Inkscape\\bin\\inkscape.exe',
    });

    expect(loadSettings()).toMatchObject({
      recentFiles: ['/tmp/a.md'],
      themeMode: 'sepia',
      fontScale: 1.2,
      visualStyle: 'technical-code',
      outlineOpen: false,
      sidebarWidth: 420,
      sidebarView: 'files',
      explorerRootPath: '/tmp',
      inspectorOpen: false,
      authorshipVisible: false,
      focusMode: true,
      documentType: 'report',
      onboardingComplete: true,
      inkscapePath: 'C:\\Program Files\\Inkscape\\bin\\inkscape.exe',
    });
  });

  it('migrates the legacy Science default once without blocking future Science selections', () => {
    localStorage.setItem('scienfy.markdown.settings.v1', JSON.stringify({
      recentFiles: ['/tmp/a.md'],
      themeMode: 'dark',
      fontScale: 1,
      visualStyle: 'science',
      sidebarView: 'files',
      documentType: 'report',
    }));

    expect(loadSettings()).toMatchObject({
      recentFiles: ['/tmp/a.md'],
      visualStyle: 'scienfy',
    });

    updateSettings({ visualStyle: 'science' });

    expect(loadSettings().visualStyle).toBe('science');
  });

  it('persists the data sidebar view', () => {
    updateSettings({ sidebarView: 'data' });

    expect(loadSettings().sidebarView).toBe('data');
  });

  it('normalizes invalid persisted display settings', () => {
    localStorage.setItem('scienfy.markdown.settings.v1', JSON.stringify({
      themeMode: 'neon',
      fontScale: 100,
      visualStyle: 'poster',
      sidebarWidth: 9999,
      sidebarView: 'tree',
      explorerRootPath: 42,
      inkscapePath: '',
      documentType: 'book',
      recentFiles: [],
    }));

    expect(loadSettings()).toMatchObject({
      themeMode: 'dark',
      fontScale: 1.35,
      visualStyle: 'scienfy',
      sidebarWidth: 560,
      sidebarView: 'outline',
      explorerRootPath: null,
      inkscapePath: null,
      documentType: 'report',
    });
  });
});
