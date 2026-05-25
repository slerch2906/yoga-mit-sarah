import type { Metadata, Viewport } from 'next'
import { Mulish } from 'next/font/google'
import './globals.css'
import UpdateBanner from '@/components/UpdateBanner'

// Sarah-Wunsch 2026-05-25 (Datenschutz): Mulish lokal via Next bundlen statt
// dynamisch von Google-CDN laden. So entsteht KEINE Browser-Verbindung zu
// fonts.googleapis.com / fonts.gstatic.com — saubere DSGVO-Loesung ohne
// Consent-Banner-Pflicht (LG Muenchen I, 20.01.2022, Az. 3 O 17493/20).
const mulish = Mulish({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-mulish',
})

export const metadata: Metadata = {
  title: 'Yoga mit Sarah',
  description: 'Kursbuchung & Verwaltung',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Yoga mit Sarah',
  },
}

export const viewport: Viewport = {
  themeColor: '#cfcbca',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={mulish.variable}>
      <head>
        {/* Sarah-Wunsch 2026-05-25 (Datenschutz): Mulish ist jetzt via next/font/google
            lokal gebundelt — keine externe Verbindung zu Google-Servern mehr.
            Tabler Icons bleiben vorerst via jsdelivr-CDN (Cloudflare, USA) —
            siehe Punkt 1.5 der Datenschutz-Analyse. */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" />

        {/* Apple PWA Tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Yoga mit Sarah" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=2" />
        <link rel="apple-touch-startup-image" href="/logo-512.png?v=2" />
        <link rel="icon" type="image/png" sizes="192x192" href="/logo-192.png?v=2" />
        <link rel="icon" type="image/png" sizes="512x512" href="/logo-512.png?v=2" />

        <script dangerouslySetInnerHTML={{ __html: `
          // Service Worker registrieren
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js').then(function(reg) {
                console.log('SW registered:', reg.scope);
              }).catch(function(err) {
                console.log('SW error:', err);
              });
            });
          }

          // PWA Install Prompt - Android/Chrome
          // Banner NICHT zeigen auf Auth- und Onboarding-Pages (AGB, Login etc.)
          // sondern erst wenn der Yogi in der App "angekommen" ist.
          var INSTALL_BLOCKED_PATHS = ['/rechtliches', '/login', '/register', '/profil/passwort', '/'];
          // Sarah-Wunsch 2026-05-25: Banner erst NACH der Welcome-Tour zeigen,
          // sonst überlagert es die Tour-Modals. Flag wird vom OnboardingTour
          // gesetzt (finish/Überspringen) oder direkt in /kurse wenn der Yogi
          // die Tour bereits absolviert hat (onboarding_completed=true).
          function onboardingDone() {
            try { return localStorage.getItem('onboarding_completed') === '1'; } catch(e) { return false; }
          }
          var installPrompt = null;
          window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
            installPrompt = e;
            // Banner nach 3 Sekunden anzeigen wenn noch nicht installiert UND nicht auf Auth-Page
            setTimeout(function() {
              if (!installPrompt) return;
              if (window.matchMedia('(display-mode: standalone)').matches) return;
              if (INSTALL_BLOCKED_PATHS.indexOf(window.location.pathname) !== -1) return;
              if (!onboardingDone()) return;
              showInstallBanner();
            }, 3000);
          });

          // Falls Yogi gerade auf einer blocked-page ist und später navigiert:
          // Banner zeigen sobald sich pathname zu einer erlaubten Page ändert.
          var bannerCheckInterval = setInterval(function() {
            if (!installPrompt) return;
            if (document.getElementById('pwa-install-banner')) { clearInterval(bannerCheckInterval); return; }
            if (window.matchMedia('(display-mode: standalone)').matches) { clearInterval(bannerCheckInterval); return; }
            if (INSTALL_BLOCKED_PATHS.indexOf(window.location.pathname) !== -1) return;
            if (!onboardingDone()) return;
            showInstallBanner();
            clearInterval(bannerCheckInterval);
          }, 2000);

          function showInstallBanner() {
            if (document.getElementById('pwa-install-banner')) return;
            if (INSTALL_BLOCKED_PATHS.indexOf(window.location.pathname) !== -1) return;
            if (!onboardingDone()) return;
            var banner = document.createElement('div');
            banner.id = 'pwa-install-banner';
            banner.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#3d3a39;color:#f5f2f0;padding:12px 16px;border-radius:12px;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:340px;width:calc(100%-32px);font-family:Mulish,sans-serif;';
            banner.innerHTML = '<img src="/apple-touch-icon.png?v=2" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">' +
              '<div style="flex:1;font-size:13px;"><strong>Yoga mit Sarah</strong><br><span style="opacity:0.7;font-size:12px;">Zum Startbildschirm hinzufügen</span></div>' +
              '<button onclick="doInstall()" style="background:#cfcbca;color:#3d3a39;border:none;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;font-size:13px;">Installieren</button>' +
              '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:#f5f2f0;cursor:pointer;font-size:18px;opacity:0.6;padding:4px;">✕</button>';
            document.body.appendChild(banner);
          }

          function doInstall() {
            if (installPrompt) {
              installPrompt.prompt();
              installPrompt.userChoice.then(function(r) {
                console.log('Install choice:', r.outcome);
                installPrompt = null;
                var b = document.getElementById('pwa-install-banner');
                if (b) b.remove();
              });
            }
          }

          window.addEventListener('appinstalled', function() {
            var b = document.getElementById('pwa-install-banner');
            if (b) b.remove();
            console.log('PWA installed!');
          });
        ` }} />
      </head>
      <body className="bg-yoga-bg text-yoga-text font-sans min-h-screen">
        {children}
        <UpdateBanner />
      </body>
    </html>
  )
}
