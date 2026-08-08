import { Search } from 'lucide-react'
import type { ReactNode } from 'react'

type PageHeaderProps = Readonly<{
  title: string
  description: string
  search?: string
  onSearch?: (value: string) => void
  actions?: ReactNode
}>

export function PageHeader({ title, description, search, onSearch, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="page-header-actions">
        {onSearch && (
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="搜索"
              onChange={(event) => onSearch(event.target.value)}
              placeholder="搜索..."
              value={search ?? ''}
            />
            <kbd>⌘ K</kbd>
          </label>
        )}
        {actions}
      </div>
    </header>
  )
}
