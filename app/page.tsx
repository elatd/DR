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
  Upload,
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

export default function Home() {
  // Consolidated state management
  const [state, setState] = useState<State>({
    query: '',
    timeFilter: 'all',
    results: [],
    selectedResults: [],
    reportPrompt: '',
    report: null,
    error: null,
    newUrl: '',
    isSourcesOpen: false,
    selectedModel: DEFAULT_MODEL,
    isAgentMode: false,
    sidebarOpen: false,
    activeTab: 'search',
    status: {
      loading: false,
      generatingReport: false,
      agentStep: 'idle',
      fetchStatus: { total: 0, successful: 0, fallback: 0, sourceStatuses: {} },
      agentInsights: [],
      searchQueries: [],
    },
  })

  const { toast } = useToast()

  // Add form ref
  const formRef = useRef<HTMLFormElement>(null)

  // Memoized state update functions
  const updateState = useCallback((updates: Partial<State>) => {
    setState((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateStatus = useCallback(
    (updates: Partial<Status> | ((prev: Status) => Status)) => {
      setState((prev) => {
        const newStatus =
          typeof updates === 'function'
            ? updates(prev.status)
            : { ...prev.status, ...updates }
        return { ...prev, status: newStatus }
      })
    },
    []
  )

  // Memoized error handler
  const handleError = useCallback(
    (error: unknown, context: string) => {
      let message = 'An unexpected error occurred'

      if (error instanceof Error) {
        message = error.message
      } else if (error instanceof Response) {
        // Handle Response objects from fetch
        message = `Server error: ${error.status}`
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'error' in error
      ) {
        // Handle error objects with error message
        message = (error as { error: string }).error
      } else if (typeof error === 'string') {
        message = error
      }

      updateState({ error: message })
      toast({
        title: context,
        description: message,
        variant: 'destructive',
        duration: 5000,
      })
    },
    [toast, updateState]
  )

  // Memoized content fetcher with proper type handling
  const fetchContent = useCallback(async (url: string) => {
    try {
      const response = await fetch('/api/fetch-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ error: 'Failed to fetch content' }))
        throw new Error(
          errorData.error || `Failed to fetch content: ${response.status}`
        )
      }

      const data = await response.json()
      return data
    } catch (error) {
      if (error instanceof Error && error.message.includes('429')) throw error
      console.error('Content fetch error:', error)
      throw error
    }
  }, [])

  // Memoized result selection handler
  const handleResultSelect = useCallback((resultId: string) => {
    setState((prev: State) => {
      if (prev.selectedResults.includes(resultId)) {
        return {
          ...prev,
          selectedResults: prev.selectedResults.filter((id) => id !== resultId),
          reportPrompt:
            prev.selectedResults.length <= 1 ? '' : prev.reportPrompt,
        }
      }
      if (prev.selectedResults.length >= MAX_SELECTIONS) return prev

      const newSelectedResults = [...prev.selectedResults, resultId]
      let newReportPrompt = prev.reportPrompt

      if (
        !prev.isAgentMode &&
        newSelectedResults.length === 1 &&
        !prev.reportPrompt
      ) {
        const result = prev.results.find((r) => r.id === resultId)
        if (result) {
          newReportPrompt = `Analyze and summarize the key points from ${result.name}`
        }
      }

      return {
        ...prev,
        selectedResults: newSelectedResults,
        reportPrompt: newReportPrompt,
      }
    })
  }, [])

  // Memoized search handler
  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!state.query.trim()) return

      const isGeneratingReport =
        state.selectedResults.length > 0 && !state.isAgentMode

      if (isGeneratingReport) {
        updateStatus({ generatingReport: true })
        updateState({ error: null })
        const initialFetchStatus: Status['fetchStatus'] = {
          total: state.selectedResults.length,
          successful: 0,
          fallback: 0,
          sourceStatuses: {},
        }
        updateStatus({ fetchStatus: initialFetchStatus })

        try {
          const contentResults = await Promise.all(
            state.results
              .filter((r) => state.selectedResults.includes(r.id))
              .map(async (article) => {
                // If the article already has content (e.g. from file upload), use it directly
                if (article.content) {
                  updateStatus((prev: Status) => ({
                    ...prev,
                    fetchStatus: {
                      ...prev.fetchStatus,
                      successful: prev.fetchStatus.successful + 1,
                      sourceStatuses: {
                        ...prev.fetchStatus.sourceStatuses,
                        [article.url]: 'fetched' as const,
                      },
                    },
                  }))
                  return {
                    url: article.url,
                    title: article.name,
                    content: article.content,
                  }
                }

                try {
                  const { content } = await fetchContent(article.url)
                  if (content) {
                    updateStatus((prev: Status) => ({
                      ...prev,
                      fetchStatus: {
                        ...prev.fetchStatus,
                        successful: prev.fetchStatus.successful + 1,
                        sourceStatuses: {
                          ...prev.fetchStatus.sourceStatuses,
                          [article.url]: 'fetched' as const,
                        },
                      },
                    }))
                    return { url: article.url, title: article.name, content }
                  }
                } catch (error) {
                  if (error instanceof Error && error.message.includes('429'))
                    throw error
                  console.error(
                    'Content fetch error for article:',
                    article.url,
                    error
                  )
                }
                updateStatus((prev: Status) => ({
                  ...prev,
                  fetchStatus: {
                    ...prev.fetchStatus,
                    fallback: prev.fetchStatus.fallback + 1,
                    sourceStatuses: {
                      ...prev.fetchStatus.sourceStatuses,
                      [article.url]: 'preview' as const,
                    },
                  },
                }))
                return {
                  url: article.url,
                  title: article.name,
                  content: article.snippet,
                }
              })
          )

          const response = await retryWithBackoff(async () => {
            const res = await fetch('/api/report', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                selectedResults: contentResults.filter((r) =>
                  r.content?.trim()
                ),
                sources: state.results.filter((r) =>
                  state.selectedResults.includes(r.id)
                ),
                prompt: `${state.query}. Provide comprehensive analysis.`,
                platformModel: state.selectedModel,
              }),
            })

            if (!res.ok) {
              const errorData = await res
                .json()
                .catch(() => ({ error: 'Failed to generate report' }))
              throw new Error(
                errorData.error || `Failed to generate report: ${res.status}`
              )
            }

            return res.json()
          })

          updateState({
            report: response,
            activeTab: 'report',
          })
        } catch (error) {
          handleError(error, 'Report Generation Failed')
        } finally {
          updateStatus({ generatingReport: false })
        }
        return
      }

      updateStatus({ loading: true })
      updateState({ error: null, reportPrompt: '' })

      try {
        const response = await retryWithBackoff(async () => {
          const res = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: state.query,
              timeFilter: state.timeFilter,
            }),
          })

          if (!res.ok) {
            const errorData = await res
              .json()
              .catch(() => ({ error: 'Search failed' }))
            throw new Error(errorData.error || `Search failed: ${res.status}`)
          }

          return res.json()
        })

        const newResults = (response.webPages?.value || []).map(
          (result: SearchResult) => ({
            ...result,
            id: `search-${Date.now()}-${result.id || result.url}`,
          })
        )

        setState((prev) => ({
          ...prev,
          results: [
            ...prev.results.filter(
              (r) => r.isCustomUrl || prev.selectedResults.includes(r.id)
            ),
            ...newResults.filter(
              (newResult: SearchResult) =>
                !prev.results.some((existing) => existing.url === newResult.url)
            ),
          ],
          error: null,
        }))
      } catch (error) {
        handleError(error, 'Search Error')
      } finally {
        updateStatus({ loading: false })
      }
    },
    [
      state.query,
      state.timeFilter,
      state.selectedResults,
      state.selectedModel,
      state.results,
      state.isAgentMode,
      fetchContent,
      handleError,
      updateStatus,
      updateState,
    ]
  )

  // Add effect to handle form submission after query update
  useEffect(() => {
    if (
      state.query === state.reportPrompt &&
      state.reportPrompt &&
      state.selectedResults.length > 0
    ) {
      if (formRef.current) {
        formRef.current.dispatchEvent(
          new Event('submit', { cancelable: true, bubbles: true })
        )
      }
    }
  }, [state.query, state.reportPrompt, state.selectedResults.length])

  const generateReport = useCallback(() => {
    if (!state.reportPrompt || state.selectedResults.length === 0) return
    updateState({ query: state.reportPrompt })
  }, [state.reportPrompt, state.selectedResults.length, updateState])

  // Memoized agent search handler
  const handleAgentSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!state.reportPrompt.trim()) {
        toast({
          title: 'Missing Information',
          description: 'Please provide a research topic',
          variant: 'destructive',
        })
        return
      }

      updateStatus({
        agentStep: 'processing',
        agentInsights: [],
        searchQueries: [],
      })
      updateState({
        error: null,
        results: [],
        selectedResults: [],
        report: null,
      })

      try {
        // Step 1: Get optimized query and research prompt
        const { query, optimizedPrompt, explanation, suggestedStructure } =
          await retryWithBackoff(async () => {
            const response = await fetch('/api/optimize-research', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: state.reportPrompt,
                platformModel: state.selectedModel,
              }),
            })
            if (!response.ok) {
              throw new Error(
                `Failed to optimize research: ${response.status} ${response.statusText}`
              )
            }
            return response.json()
          })

        // Update the query state to show optimized query
        updateState({ query: query })

        updateStatus((prev: Status) => ({
          ...prev,
          searchQueries: [query],
          agentInsights: [
            ...prev.agentInsights,
            `Research strategy: ${explanation}`,
            ...(Array.isArray(suggestedStructure)
              ? [`Suggested structure: ${suggestedStructure.join(' → ')}`]
              : []),
          ],
        }))

        // Step 2: Perform search with optimized query
        updateStatus({ agentStep: 'searching' })
        console.log('Performing search with optimized query:', query)
        const searchResponse = await retryWithBackoff(async () => {
          const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              timeFilter: state.timeFilter,
              isTestQuery: query.toLowerCase() === 'test',
            }),
          })
          if (!response.ok) {
            const errorData = await response
              .json()
              .catch(() => ({ error: 'Could not parse error response' }))
            console.error('Search failed:', {
              status: response.status,
              query,
              error: errorData,
            })
            if (response.status === 429) {
              throw new Error('Rate limit exceeded')
            }
            if (response.status === 403) {
              throw new Error(
                'Search quota exceeded. Please try again later or contact support.'
              )
            }
            throw new Error('Search failed')
          }
          return response.json()
        })

        const searchResults = searchResponse.webPages?.value || []
        if (searchResults.length === 0) {
          throw new Error(
            'No search results found. Please try a different query.'
          )
        }

        // Process results
        const timestamp = Date.now()
        const allResults = searchResults.map(
          (result: SearchResult, idx: number) => ({
            ...result,
            id: `search-${timestamp}-${idx}-${result.url}`,
            score: 0,
          })
        )

        // Step 3: Analyze and rank results
        updateStatus({ agentStep: 'analyzing' })
        const { rankings, analysis } = await retryWithBackoff(async () => {
          const response = await fetch('/api/analyze-results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: optimizedPrompt,
              results: allResults.map((r: SearchResult) => ({
                title: r.name,
                snippet: r.snippet,
                url: r.url,
                content: r.content,
              })),
              isTestQuery: query.toLowerCase() === 'test',
              platformModel: state.selectedModel,
            }),
          })
          if (!response.ok) {
            throw new Error(
              `Failed to analyze results: ${response.status} ${response.statusText}`
            )
          }
          return response.json()
        })

        const rankedResults = allResults
          .map((result: SearchResult) => ({
            ...result,
            score:
              rankings.find((r: RankingResult) => r.url === result.url)
                ?.score || 0,
          }))
          .sort(
            (a: SearchResult, b: SearchResult) =>
              (b.score || 0) - (a.score || 0)
          )

        if (rankedResults.every((r: SearchResult) => r.score === 0)) {
          throw new Error(
            'No relevant results found. Please try a different query.'
          )
        }

        updateStatus((prev: Status) => ({
          ...prev,
          agentInsights: [
            ...prev.agentInsights,
            `Analysis: ${analysis}`,
            `Found ${rankedResults.length} relevant results`,
          ],
        }))

        // Select top results with diversity heuristic
        const selectedUrls = new Set<string>()
        const selected = rankedResults.filter((result: SearchResult) => {
          if (selectedUrls.size >= CONFIG.search.maxSelectableResults)
            return false
          const domain = new URL(result.url).hostname
          const hasSimilar = Array.from(selectedUrls).some(
            (url) => new URL(url).hostname === domain
          )
          if (!hasSimilar && result.score && result.score > 0.5) {
            selectedUrls.add(result.url)
            return true
          }
          return false
        })

        if (selected.length === 0) {
          throw new Error(
            'Could not find enough diverse, high-quality sources. Please try a different query.'
          )
        }

        updateState({
          results: rankedResults,
          selectedResults: selected.map((r: SearchResult) => r.id),
        })

        updateStatus((prev: Status) => ({
          ...prev,
          agentInsights: [
            ...prev.agentInsights,
            `Selected ${selected.length} diverse sources from ${
              new Set(
                selected.map((s: SearchResult) => new URL(s.url).hostname)
              ).size
            } unique domains`,
          ],
        }))

        // Step 4: Generate report
        updateStatus({ agentStep: 'generating' })
        const initialFetchStatus: Status['fetchStatus'] = {
          total: selected.length,
          successful: 0,
          fallback: 0,
          sourceStatuses: {},
        }
        updateStatus({ fetchStatus: initialFetchStatus })

        const contentResults = await Promise.all(
          selected.map(async (article: SearchResult) => {
            // If the article already has content (e.g. from file upload), use it directly
            if (article.content) {
              updateStatus((prev: Status) => ({
                ...prev,
                fetchStatus: {
                  ...prev.fetchStatus,
                  successful: prev.fetchStatus.successful + 1,
                  sourceStatuses: {
                    ...prev.fetchStatus.sourceStatuses,
                    [article.url]: 'fetched' as const,
                  },
                },
              }))
              return {
                url: article.url,
                title: article.name,
                content: article.content,
              }
            }

            try {
              const { content } = await fetchContent(article.url)
              if (content) {
                updateStatus((prev: Status) => ({
                  ...prev,
                  fetchStatus: {
                    ...prev.fetchStatus,
                    successful: prev.fetchStatus.successful + 1,
                    sourceStatuses: {
                      ...prev.fetchStatus.sourceStatuses,
                      [article.url]: 'fetched' as const,
                    },
                  },
                }))
                return { url: article.url, title: article.name, content }
              }
            } catch (error) {
              if (error instanceof Error && error.message.includes('429'))
                throw error
            }
            updateStatus((prev: Status) => ({
              ...prev,
              fetchStatus: {
                ...prev.fetchStatus,
                fallback: prev.fetchStatus.fallback + 1,
                sourceStatuses: {
                  ...prev.fetchStatus.sourceStatuses,
                  [article.url]: 'preview' as const,
                },
              },
            }))
            return {
              url: article.url,
              title: article.name,
              content: article.snippet,
            }
          })
        )

        const reportResponse = await retryWithBackoff(() =>
          fetch('/api/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              selectedResults: contentResults.filter((r) => r.content?.trim()),
              sources: selected,
              prompt: `${optimizedPrompt}. Provide comprehensive analysis.`,
              platformModel: state.selectedModel,
            }),
          }).then((res) => res.json())
        )

        updateState({
          report: reportResponse,
          activeTab: 'report',
        })

        updateStatus((prev: Status) => ({
          ...prev,
          agentInsights: [
            ...prev.agentInsights,
            `Report generated successfully`,
          ],
          agentStep: 'idle',
        }))
      } catch (error) {
        handleError(error, 'Agent Error')
      }
    },
    [
      state.reportPrompt,
      state.timeFilter,
      generateReport,
      handleError,
      updateState,
      updateStatus,
    ]
  )

  // Memoized utility functions
  const handleAddCustomUrl = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!state.newUrl.trim()) return

      try {
        new URL(state.newUrl) // Validate URL format
        if (!state.results.some((r) => r.url === state.newUrl)) {
          const timestamp = Date.now()
          const newResult: SearchResult = {
            id: `custom-${timestamp}-${state.newUrl}`,
            url: state.newUrl,
            name: 'Custom URL',
            snippet: 'Custom URL added by user',
            isCustomUrl: true,
          }
          setState((prev: State) => ({
            ...prev,
            results: [newResult, ...prev.results],
            newUrl: '',
          }))
        }
      } catch {
        handleError('Please enter a valid URL', 'Invalid URL')
      }
    },
    [state.newUrl, state.results, handleError]
  )

  const handleRemoveResult = useCallback((resultId: string) => {
    setState((prev: State) => ({
      ...prev,
      results: prev.results.filter((r) => r.id !== resultId),
      selectedResults: prev.selectedResults.filter((id) => id !== resultId),
    }))
  }, [])

  // Add file upload handler
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const result = await handleLocalFile(
        file,
        (loading) => {
          updateState({ error: null })
          updateStatus({ loading })
        },
        (error, context) => {
          toast({
            title: context,
            description: error instanceof Error ? error.message : String(error),
            variant: 'destructive',
          })
          updateState({
            error: error instanceof Error ? error.message : String(error),
          })
        }
      )

      if (result) {
        setState((prev: State) => ({
          ...prev,
          results: [result, ...prev.results],
        }))
      }

      // Reset the file input
      e.target.value = ''
    },
    [setState, updateState, updateStatus, toast]
  )

  return (
    <div className='min-h-screen bg-white p-4 sm:p-8'>
      <KnowledgeBaseSidebar
          open={state.sidebarOpen}
          onOpenChange={(open) => updateState({ sidebarOpen: open })}
        />
      <main className='max-w-4xl mx-auto space-y-8'>
          <div className='mb-3'>
            <h1 className='mb-2 text-center text-gray-800 flex items-center justify-center gap-2'>
              <img
                src='/capitalistsheet.png'
                alt='Capitalist Sheet'
                className='w-6 h-6 sm:w-8 sm:h-8 rounded-full'
              />
              <span className='text-xl sm:text-3xl font-bold font-heading'>
                Capitalist Sheet
              </span>
            </h1>
            <div className='text-center space-y-3 mb-8'>
              <p className='text-gray-600'>Capitalist Sheet</p>
              <div className='flex flex-wrap justify-center items-center gap-2'>
                <Button
                  variant='default'
                  size='sm'
                  onClick={() => updateState({ sidebarOpen: true })}
                  className='inline-flex items-center gap-1 sm:gap-2 text-xs sm:text-sm rounded-full'
                >
                  <Brain className='h-4 w-4' />
                  View Knowledge Base
                </Button>
              </div>
              <div className='flex justify-center items-center'>
                <div className='flex items-center space-x-2'>
                  <div className='flex flex-col gap-2 w-full'>
                    <div className='flex items-center space-x-2'>
                      <Checkbox
                        id='agent-mode'
                        checked={state.isAgentMode}
                        className='w-4 h-4'
                        onCheckedChange={(checked) =>
                          updateState({ isAgentMode: checked as boolean })
                        }
                      />
                      <label
                        htmlFor='agent-mode'
                        className='text-xs sm:text-sm font-medium leading-none text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                      >
                        Agent Mode (Automatic search and report generation)
                      </label>
                    </div>
                    {state.isAgentMode && (
                      <Tabs defaultValue='deep-research' className='w-full'>
                        <TabsList className='grid w-full grid-cols-2'>
                          <TabsTrigger value='deep-research'>Deep Research</TabsTrigger>
                          <TabsTrigger value='upload-files'>Upload Files</TabsTrigger>
                        </TabsList>
                        <TabsContent value='deep-research' className='space-y-4'>
                          <div className='space-y-4'>
                            <Input
                              value={state.query || state.reportPrompt}
                              onChange={(e) => {
                                updateState({
                                  reportPrompt: e.target.value,
                                  query: '',
                                })
                              }}
                              placeholder="What would you like to research?"
                              className='text-lg'
                            />
                            <div className='flex gap-2'>
                              <Input
                                type='url'
                                value={state.newUrl}
                                onChange={(e) => updateState({ newUrl: e.target.value })}
                                placeholder='Add custom URL...'
                                className='flex-1'
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    handleAddCustomUrl(e)
                                  }
                                }}
                              />
                              <Button
                                type='button'
                                variant='outline'
                                onClick={handleAddCustomUrl}
                                className='whitespace-nowrap'
                              >
                                <Plus className='h-4 w-4 mr-2' />
                                Add URL
                              </Button>
                            </div>
                          </div>
                        </TabsContent>
                        <TabsContent value='upload-files' className='space-y-4'>
                          <div className='border-2 border-dashed rounded-lg p-8 text-center'>
                            <Input
                              type='file'
                              onChange={handleFileUpload}
                              className='hidden'
                              id='file-upload'
                              accept={SUPPORTED_FILE_TYPES}
                              multiple
                            />
                            <label
                              htmlFor='file-upload'
                              className='cursor-pointer flex flex-col items-center gap-2'
                            >
                              <Upload className='h-8 w-8 text-gray-400' />
                              <div className='text-sm text-gray-600'>
                                <span className='text-primary font-semibold'>
                                  Click to upload
                                </span>{' '}
                                or drag and drop
                              </div>
                              <p className='text-xs text-gray-500'>
                                Supported formats: TXT, PDF, DOCX
                              </p>
                            </label>
                          </div>
                        </TabsContent>
                      </Tabs>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {state.status.agentStep !== 'idle' && (
              <div className='mb-4 p-4 bg-blue-50 rounded-lg'>
                <div className='flex items-center gap-3 mb-3'>
                  <Loader2 className='h-5 w-5 text-blue-600 animate-spin' />
                  <h3 className='font-semibold text-