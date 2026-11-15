import { expect, test } from '@playwright/test';

// 앱은 상대 경로로 빌드되므로 주소는 항상 './' 기준으로 연다(예: './#lines').
test('앱이 열리고 오류 없이 첫 화면이 그려진다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('./');
  await expect(page).toHaveTitle(/콜사인/);
  await expect(page.locator('#root')).not.toBeEmpty();
  await page.waitForLoadState('networkidle');

  expect(errors).toEqual([]);
});
