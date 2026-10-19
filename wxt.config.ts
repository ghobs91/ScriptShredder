import { defineConfig } from 'wxt';

const ICONS = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  96: 'icon/96.png',
  128: 'icon/128.png',
};

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'ScriptShredder',
    description:
      'Block third-party JavaScript on every site — without turning off all JavaScript.',
    icons: ICONS,
    action: {
      default_title: 'ScriptShredder',
      default_icon: ICONS,
    },
    permissions: ['storage', 'declarativeNetRequest', 'activeTab'],
    host_permissions: ['http://*/*', 'https://*/*'],
    ...(browser === 'chrome' ? { minimum_chrome_version: '120' } : {}),
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'scriptshredder@scriptshredder.dev',
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
            gecko_android: {
              strict_min_version: '142.0',
            },
          },
        }
      : {}),
    ...(browser === 'safari'
      ? {
          browser_specific_settings: {
            safari: {
              strict_min_version: '26.0',
            },
          },
        }
      : {}),
  }),
});
