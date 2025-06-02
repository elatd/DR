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
  const [searchQuery, setSearchQuery] = useState('')
  const [timeFilter, setTimeFilter] = useState<typeof timeFilters[number]['value']>('all')
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL)
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col space-y-8">
        {/* Search Section */}
        <div className="flex flex-col space-y-4">
          <div className="flex space-x-4">
            <Input
              placeholder="Enter your search query..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={() => {
                if (!searchQuery.trim()) {
                  toast({
                    title: "Error",
                    description: "Please enter a search query",
                    variant: "destructive"
                  })
                  return
                }
                setIsLoading(true)
                // Search functionality would be implemented here
              }}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              <span className="ml-2">Search</span>
            </Button>
          </div>

          <div className="flex space-x-4 items-center">
            <ModelSelect
              value={selectedModel}
              onChange={setSelectedModel}
            />
            <Select value={timeFilter} onValueChange={setTimeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select time range" />
              </SelectTrigger>
              <SelectContent>
                {timeFilters.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Results Section */}
        <div className="space-y-4">
          <Tabs defaultValue="results">
            <TabsList>
              <TabsTrigger value="results">Results</TabsTrigger>
              <TabsTrigger value="knowledge-base">Knowledge Base</TabsTrigger>
            </TabsList>
            <TabsContent value="results">
              <Card>
                <CardContent className="p-6">
                  {isLoading ? (
                    <div className="flex justify-center items-center py-8">
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                  ) : (
                    <p className="text-center text-gray-500">
                      Enter a search query to see results
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="knowledge-base">
              <KnowledgeBaseSidebar />
            </TabsContent>
          </Tabs>
        </div>

        <CitationsFooter />
      </div>
    </div>
  )
}