import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export const defaultNamespace = 'app';

export const resources = {
  en: {
    app: {
      accessibility: {
        skipToEditor: 'Skip to editor',
      },
      dialogs: {
        commandPaletteTitle: 'Command palette',
      },
    },
  },
} as const;

if (!i18n.isInitialized) {
  void i18n
    .use(initReactI18next)
    .init({
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: defaultNamespace,
      resources,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    });
}

export default i18n;
