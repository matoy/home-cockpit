import { expect, test } from '@playwright/test';

test.describe('Home Cockpit Dashboard (Demo Mode)', () => {
  test.beforeEach(async ({ page }) => {
    const res = await page.request.post('/api/auth/login', {
      data: { password: 'e2e-demo-password' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('loads overview with grouped navigation and 14 tabs', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Home Cockpit' })).toBeVisible();
    await expect(page.getByText('Demo Mode').first()).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    await expect(nav.getByText('Monitoring', { exact: true })).toBeVisible();
    await expect(nav.getByText('Equipment', { exact: true })).toBeVisible();
    await expect(nav.getByText('Setup', { exact: true })).toBeVisible();

    const expectedTabs = [
      'Overview',
      'Health',
      'Energy & Costs',
      'Climate',
      'Openings',
      'Shutters & Blinds',
      'HVAC & Heat Pumps',
      'Security & Sensors',
      'Automations',
      'Devices',
      'Rooms',
      'Systems',
      'kWh Tariffs',
      'Setup Guide',
    ];
    for (const label of expectedTabs) {
      await expect(nav.getByRole('button', { name: new RegExp(label) })).toBeVisible();
    }
  });

  test('navigates across updated Lot 1-3 tabs and triggers Systems Sync all', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });

    await nav.getByRole('button', { name: /Health/ }).click();
    await expect(page.getByText('Overall Health')).toBeVisible();
    await expect(page.getByText(/Low Batteries/)).toBeVisible();

    await nav.getByRole('button', { name: 'Energy & Costs' }).click();
    await expect(page.getByRole('button', { name: /Export CSV/ })).toBeVisible();

    await nav.getByRole('button', { name: 'Climate' }).click();
    await expect(page.getByText('Climate Statistics by Room')).toBeVisible();
    await expect(page.getByRole('button', { name: /Export CSV/ })).toBeVisible();
    await expect(page.getByText('Connectivity & Batteries')).toBeVisible();

    await nav.getByRole('button', { name: /Openings/ }).click();
    await expect(page.getByText('Connectivity & Batteries')).toBeVisible();

    await nav.getByRole('button', { name: /Shutters & Blinds/ }).click();
    await expect(page.getByText('Health & Signal')).toHaveCount(0);

    await nav.getByRole('button', { name: /Security & Sensors/ }).click();
    await expect(page.getByText('Connectivity & Batteries')).toBeVisible();

    await nav.getByRole('button', { name: 'kWh Tariffs' }).click();
    await expect(page.getByText('EDF Tempo Plan', { exact: true })).toBeVisible();

    await nav.getByRole('button', { name: /Systems/ }).click();
    const syncAllButton = page.getByRole('button', { name: 'Sync all' });
    await expect(syncAllButton).toBeVisible();
    await syncAllButton.click();
    await expect(page.getByText(/system\(s\) synced successfully|Sync finished/)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('persists active tab and time range in URL across page reloads', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });

    await nav.getByRole('button', { name: 'Climate' }).click();
    await page.getByRole('button', { name: '7 days' }).click();

    await expect(page).toHaveURL(/tab=climate/);
    await expect(page).toHaveURL(/range=7d/);

    await page.reload();

    await expect(page).toHaveURL(/tab=climate/);
    await expect(page).toHaveURL(/range=7d/);
    await expect(page.getByText('Climate Statistics by Room')).toBeVisible();
  });

  test('toggles light/dark theme and persists selection across reloads via SSR cookie', async ({
    page,
  }) => {
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveClass(/\bdark\b/);

    const toggle = page.getByTestId('theme-toggle');
    await toggle.click();
    await expect(html).toHaveClass(/\blight\b/);

    await page.reload();
    await expect(html).toHaveClass(/\blight\b/);

    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveClass(/\bdark\b/);
  });
});
