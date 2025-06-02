'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Search,
  FileText,
  UploadIcon,
  Plus,
  X,
  ChevronDown,
  Brain,
  Loader2,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import type { SearchResult, RankingResult, Status, State } from '@/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CONFIG } from '@/lib/config'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useToast } from '@/hooks/use-toast'
import { KnowledgeBaseSidebar } from '@/components/knowledge-base-sidebar'
import { ReportActions } from '@/components/report-actions'
import { ModelSelect, DEFAULT_MODEL } from '@/components/model-select'
import { handleLocalFile, SUPPORTED_FILE_TYPES } from '@/lib/file-upload'
import { CitationsFooter } from '@/components/citations-footer'

const timeFilters = [
  { value: 'all', label: 'Any time' },
  { value: '24h', label: 'Past 24 hours' },
  { value: 'week', label: 'Past week' },
  { value: 'month', label: 'Past month' },
  { value: 'year', label: 'Past year' },
] as const

const MAX_SELECTIONS = CONFIG.search.maxSelectableResults

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const retryWithBackoff = async <T,>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: any
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (error instanceof Error && error.message.includes('429')) {
        const delay = baseDelay * Math.pow(2, i)
        console.log(`Rate limited, retrying in ${delay}ms...`)
        await sleep(delay)
        continue
      }
      throw error
    }
  }
  throw lastError
}

export default function HomePage() {
  // Rest of the component code from app/page.tsx...
  ${state.results.length > 0 && (
    <Tabs
      value={state.activeTab}
      onValueChange={(value) => updateState({ activeTab: value })}
      className='w-full'
    >
      // ... Rest of the component implementation
    </Tabs>
  )}
}