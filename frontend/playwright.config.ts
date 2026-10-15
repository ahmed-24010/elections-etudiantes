import { defineConfig, devices } from '@playwright/test';

// D-37 « mobile d'abord » : l'application est testée avec un iPhone (WebKit) et un Android (Chromium mobile).
// Le serveur de développement suffit pour les pages publiques ; l'API n'est pas nécessaire ici.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: { baseURL: 'http://127.0.0.1:4300', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx ng serve --host 127.0.0.1 --port 4300',
    url: 'http://127.0.0.1:4300',
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 14'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
