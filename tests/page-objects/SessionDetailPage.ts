import { Page, expect } from '@playwright/test'

export class SessionDetailPage {
  constructor(private page: Page) {}

  async goto(sessionId: string) {
    await this.page.goto(`/kurse/${sessionId}`)
    await this.page.waitForLoadState('networkidle')
  }

  async expectCourseName(name: string) {
    await expect(this.page.getByText(name).first()).toBeVisible()
  }

  // ── Buchung ───────────────────────────────────────────────────────────────

  async book() {
    await this.page.getByRole('button', { name: /jetzt anmelden|buchen|einschreiben/i }).click()
    // Warte auf Erfolgsmeldung oder Status-Wechsel
    await expect(
      this.page.getByText(/angemeldet|buchung bestätigt|erfolgreich/i)
    ).toBeVisible({ timeout: 10_000 })
  }

  async expectBookedStatus() {
    await expect(this.page.getByText(/angemeldet/i).first()).toBeVisible()
  }

  async expectNoBookButton() {
    await expect(
      this.page.getByRole('button', { name: /jetzt anmelden|buchen/i })
    ).not.toBeVisible()
  }

  // ── Abmeldung ─────────────────────────────────────────────────────────────

  async cancelBooking() {
    await this.page.getByRole('button', { name: /abmelden|stornieren/i }).click()
    // Bestätigungs-Dialog falls vorhanden
    const confirmBtn = this.page.getByRole('button', { name: /bestätigen|ja.*abmelden|abmelden/i })
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click()
    }
    await expect(
      this.page.getByText(/abgemeldet|nicht angemeldet|anmelden/i).first()
    ).toBeVisible({ timeout: 10_000 })
  }

  async expectCancellationMessage(type: 'early' | 'late') {
    if (type === 'early') {
      await expect(
        this.page.getByText(/credit.*gutgeschrieben|gutschrift|credit.*zurück/i)
      ).toBeVisible({ timeout: 5_000 })
    } else {
      await expect(
        this.page.getByText(/unter.*3|zu spät|stornofrist|credit.*nicht/i)
      ).toBeVisible({ timeout: 5_000 })
    }
  }

  // ── Warteliste ────────────────────────────────────────────────────────────

  async joinWaitlist() {
    await this.page.getByRole('button', { name: /warteliste/i }).click()
    await expect(
      this.page.getByText(/warteliste|position|vorgemerkt/i)
    ).toBeVisible({ timeout: 10_000 })
  }

  async joinNotifyList() {
    await this.page.getByRole('button', { name: /benachrichtig/i }).click()
    await expect(
      this.page.getByText(/benachrichtig|informiert/i)
    ).toBeVisible({ timeout: 10_000 })
  }

  async expectWaitlistPosition(position: number) {
    await expect(
      this.page.getByText(new RegExp(`position.*${position}|${position}.*warteliste`, 'i'))
    ).toBeVisible()
  }

  async expectFullMessage() {
    await expect(
      this.page.getByText(/ausgebucht|voll|keine.*plätze/i)
    ).toBeVisible()
  }

  // ── Abgesagte Stunde ──────────────────────────────────────────────────────

  async expectCancelledNotice() {
    await expect(
      this.page.getByText(/wurde abgesagt|abgesagt/i).first()
    ).toBeVisible()
    // Keine Buchungs-Buttons sichtbar
    await expect(
      this.page.getByRole('button', { name: /anmelden|buchen/i })
    ).not.toBeVisible()
  }
}
