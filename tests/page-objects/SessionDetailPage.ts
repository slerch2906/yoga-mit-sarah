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
    await this.page.getByRole('button', { name: /für diese stunde eintragen|trotzdem eintragen/i }).click()
    await expect(
      this.page.getByRole('heading', { name: /du bist dabei/i })
    ).toBeVisible({ timeout: 10_000 })
  }

  async expectBookedStatus() {
    await expect(this.page.getByRole('heading', { name: /du bist dabei/i })).toBeVisible()
  }

  async expectNoBookButton() {
    await expect(
      this.page.getByRole('button', { name: /für diese stunde eintragen|trotzdem eintragen/i })
    ).not.toBeVisible()
  }

  // ── Abmeldung ─────────────────────────────────────────────────────────────

  async cancelBooking() {
    await this.page.getByRole('button', { name: /von dieser stunde abmelden/i }).click()
    const confirmBtn = this.page.getByRole('button', { name: /ja, abmelden/i })
    await confirmBtn.waitFor({ timeout: 5_000 })
    await confirmBtn.click()
    await this.page.waitForURL(
      url => !new URL(url).pathname.startsWith('/kurse/'),
      { timeout: 10_000 }
    )
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
    await this.page.getByRole('button', { name: /auf die warteliste setzen/i }).click()
    await expect(
      this.page.getByText(/du stehst auf der warteliste/i)
    ).toBeVisible({ timeout: 10_000 })
  }

  async joinNotifyList() {
    await this.page.getByRole('button', { name: /benachrichtige mich/i }).click()
    await expect(
      this.page.getByText(/benachrichtigung aktiviert/i)
    ).toBeVisible({ timeout: 10_000 })
  }

  async expectWaitlistPosition(position: number) {
    await expect(
      this.page.getByText(new RegExp(`position.*${position}|${position}.*warteliste`, 'i'))
    ).toBeVisible()
  }

  async expectFullMessage() {
    await expect(
      this.page.getByText('Ausgebucht', { exact: true })
    ).toBeVisible({ timeout: 15_000 })
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
