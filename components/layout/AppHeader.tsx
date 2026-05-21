'use client'

interface AppHeaderProps {
  title: string
  subtitle?: string
  rightElement?: React.ReactNode
  isAdmin?: boolean
  showBack?: boolean
}

export default function AppHeader({ title, subtitle, rightElement, isAdmin, showBack }: AppHeaderProps) {
  return (
    <div className="app-header sticky top-0 z-10">
      <div className="w-[73px] h-[73px] flex-shrink-0 flex items-center justify-center">
        <img
          src="https://yogamitsarah.me/wp-content/uploads/2025/09/Logo-300x300.png"
          alt="Yoga mit Sarah Logo"
          className="w-[73px] h-[73px] object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/logo.png'
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-bold truncate">{title}</h1>
        {subtitle && <p className="text-xs text-yoga-text/50 mt-0.5">{subtitle}</p>}
      </div>
      {isAdmin && (
        <span className="text-xs bg-yoga-text text-yoga-bg rounded-full px-2.5 py-1 font-bold tracking-wider flex-shrink-0">
          ADMIN
        </span>
      )}
      {rightElement}
    </div>
  )
}
