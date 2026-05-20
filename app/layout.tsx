import type { Metadata, Viewport } from 'next'
import './globals.css'

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
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Mulish:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/dist/tabler-icons.min.css" />

        {/* Apple PWA Tags */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Yoga mit Sarah" />
        <link rel="apple-touch-icon" sizes="180x180" href="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png" />
        <link rel="apple-touch-startup-image" href="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png" />

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
          var installPrompt = null;
          window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
            installPrompt = e;
            // Banner nach 3 Sekunden anzeigen wenn noch nicht installiert
            setTimeout(function() {
              if (installPrompt && !window.matchMedia('(display-mode: standalone)').matches) {
                showInstallBanner();
              }
            }, 3000);
          });

          function showInstallBanner() {
            if (document.getElementById('pwa-install-banner')) return;
            var banner = document.createElement('div');
            banner.id = 'pwa-install-banner';
            banner.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#3d3a39;color:#f5f2f0;padding:12px 16px;border-radius:12px;z-index:9999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:340px;width:calc(100%-32px);font-family:Mulish,sans-serif;';
            banner.innerHTML = '<img src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png" style="width:36px;height:36px;border-radius:8px;flex-shrink:0;">' +
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
      </body>
    </html>
  )
}
