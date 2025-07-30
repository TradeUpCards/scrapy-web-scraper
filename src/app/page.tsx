'use client'

import { useState } from 'react'
import { useEffect } from 'react'

interface ScrapeResult {
  success: boolean
  data?: any
  message?: string
  error?: string
  stdout?: string
  stderr?: string
  logs?: string[]
  progress?: any
  stats?: {
    originalItems: number
    pathFilter?: string
    filterDepth?: number
    maxDepth?: number | string
    filteredAtSource?: boolean
    pagesProcessed?: number
    pagesFiltered?: number
    duplicateUrlsSkipped?: number
    totalUrlsDiscovered?: number
    totalUrlsScraped?: number
    actualDuration?: string
  }
}

interface ScrapingProgress {
  stage: 'idle' | 'initializing' | 'scraping' | 'complete' | 'error'
  message: string
  estimatedTime?: string
  currentStep?: number
  totalSteps?: number
  currentPage?: string
  progressPercent?: number
  startTime?: number
  actualDuration?: string
  stats?: {
    pagesProcessed: number
    totalUrlsDiscovered: number
    totalUrlsScraped: number
    pagesFiltered: number
    duplicateUrlsSkipped: number
  }
  logs?: string[]
}

export default function Page() {
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<ScrapeResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [exportFormat, setExportFormat] = useState<'json' | 'csv' | 'txt'>('json')
  const [progress, setProgress] = useState<ScrapingProgress>({ stage: 'idle', message: '' })
  const [filterDepth, setFilterDepth] = useState(1)
  const [maxDepth, setMaxDepth] = useState<number | undefined>(undefined)
  const [currentTimeEstimate, setCurrentTimeEstimate] = useState<string>('')

  // Update time estimate in real-time
  useEffect(() => {
    if (progress.stage === 'scraping' && progress.startTime) {
      const interval = setInterval(() => {
        const estimate = calculateDynamicTimeEstimate(progress)
        setCurrentTimeEstimate(estimate)
      }, 1000) // Update every second
      
      return () => clearInterval(interval)
    } else {
      setCurrentTimeEstimate(progress.estimatedTime || '')
    }
  }, [progress.stage, progress.startTime, progress.currentStep, progress.totalSteps, progress.estimatedTime])

  const estimateScrapingTime = (url: string, depth: number, maxDepth?: number): string => {
    // Analyze URL to estimate scope
    const urlObj = new URL(url)
    const path = urlObj.pathname
    
    // Different sections have different content density
    if (path.includes('/d4/')) {
      if (path.includes('/getting-started/')) return depth === 1 ? '2-3 minutes' : '3-5 minutes'
      if (path.includes('/build-guides/')) return depth === 1 ? '5-8 minutes' : '8-12 minutes'
      if (path.includes('/resources/')) return depth === 1 ? '3-5 minutes' : '5-8 minutes'
      return depth === 1 ? '3-5 minutes' : '5-8 minutes'
    }
    
    // Default estimates
    if (path.includes('/poe/')) return depth === 1 ? '4-6 minutes' : '6-10 minutes'
    if (path.includes('/wow/')) return depth === 1 ? '3-5 minutes' : '5-8 minutes'
    
    return depth === 1 ? '2-4 minutes' : '4-6 minutes'
  }

  const calculateDynamicTimeEstimate = (progress: ScrapingProgress): string => {
    if (!progress.startTime || !progress.currentStep || !progress.totalSteps || progress.currentStep === 0) {
      return progress.estimatedTime || 'Calculating...'
    }
    
    const elapsedMs = Date.now() - progress.startTime
    const elapsedMinutes = elapsedMs / (1000 * 60)
    const pagesPerMinute = progress.currentStep / elapsedMinutes
    
    if (pagesPerMinute <= 0) {
      return progress.estimatedTime || 'Calculating...'
    }
    
    const remainingPages = progress.totalSteps - progress.currentStep
    const remainingMinutes = remainingPages / pagesPerMinute
    
    if (remainingMinutes < 1) {
      return 'Less than 1 minute'
    } else if (remainingMinutes < 2) {
      return 'About 1 minute'
    } else {
      return `About ${Math.round(remainingMinutes)} minutes`
    }
  }

  const truncateUrl = (url: string, maxLength: number = 60): string => {
    if (url.length <= maxLength) return url
    
    const domain = new URL(url).hostname
    const path = new URL(url).pathname
    
    if (domain.length + 10 > maxLength) {
      return `${domain}...`
    }
    
    const availableLength = maxLength - domain.length - 3 // 3 for "..."
    const truncatedPath = path.length > availableLength ? 
      path.substring(0, availableLength) + '...' : 
      path
    
    return `${domain}${truncatedPath}`
  }

  const getProgressMessage = (stage: string, url: string): string => {
    switch (stage) {
      case 'initializing':
        return 'Setting up scraping environment...'
      case 'scraping':
        return 'Crawling website and extracting content...'
      case 'complete':
        return 'Scraping completed successfully!'
      case 'error':
        return 'An error occurred during scraping'
      default:
        return 'Preparing to scrape...'
    }
  }

  const scrape = async () => {
    setLoading(true)
    setResult(null)
    
    // Initialize progress
    const estimatedTime = estimateScrapingTime(url, filterDepth, maxDepth)
    setProgress({
      stage: 'initializing',
      message: getProgressMessage('initializing', url),
      estimatedTime,
      startTime: Date.now()
    })
    
    try {
      // Start the scraping process
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, filterDepth, maxDepth }),
      })

      const json = await res.json()
      
      if (json.success === true) {
        // Start polling for progress updates
        const pollInterval = setInterval(async () => {
          try {
            const progressRes = await fetch('/api/scrape')
            const progressData = await progressRes.json()
            
            // Handle all statuses, not just 'processing' and 'completed'
            if (progressData.status === 'starting' || progressData.status === 'processing' || progressData.status === 'completed') {
              
              // Parse stats from logs
              const stats = {
                pagesProcessed: 0,
                pagesFiltered: 0,
                duplicateUrlsSkipped: 0,
                totalUrlsDiscovered: 0,
                totalUrlsScraped: 0
              }
              
              if (progressData.logs && progressData.logs.length > 0) {
                progressData.logs.forEach((log: string) => {
                  if (log.includes('Processing page')) {
                    const match = log.match(/Processing page (\d+)\/(\d+)/)
                    if (match) {
                      stats.pagesProcessed = parseInt(match[1])
                      stats.totalUrlsDiscovered = parseInt(match[2])
                    }
                  }
                  if (log.includes('Total discovered:')) {
                    const match = log.match(/Total discovered: (\d+)/)
                    if (match) {
                      stats.totalUrlsDiscovered = parseInt(match[1])
                    }
                  }
                  if (log.includes('Total scraped:')) {
                    const match = log.match(/Total scraped: (\d+)/)
                    if (match) {
                      stats.totalUrlsScraped = parseInt(match[1])
                    }
                  }
                  if (log.includes('filtered out')) {
                    const match = log.match(/(\d+) filtered out/)
                    if (match) {
                      stats.pagesFiltered += parseInt(match[1])
                    }
                  }
                  if (log.includes('duplicates skipped')) {
                    const match = log.match(/(\d+) duplicates skipped/)
                    if (match) {
                      stats.duplicateUrlsSkipped += parseInt(match[1])
                    }
                  }
                })
              }
              
              // Update progress display for any active status
              if (progressData.status === 'starting') {
                setProgress(prevProgress => ({
                  stage: 'initializing',
                  message: 'Setting up scraping environment...',
                  estimatedTime,
                  startTime: prevProgress.startTime, // Preserve startTime
                  logs: progressData.logs,
                  stats
                }))
              } else if (progressData.status === 'processing') {
                // Find the LATEST processing log (last one in the array)
                const processingLog = progressData.logs?.filter((log: string) => log.includes('Processing page')).pop()
                
                let currentPage = ''
                let progressPercent = 0
                let currentStep = 0
                let totalSteps = 0
                
                if (processingLog) {
                  const match = processingLog.match(/Processing page (\d+)\/(\d+) \(([\d.]+)%\): (.+)/)
                  if (match) {
                    currentStep = parseInt(match[1])
                    totalSteps = parseInt(match[2])
                    progressPercent = parseFloat(match[3])
                    // Extract just the URL part from the currentPage field
                    const urlMatch = match[4].match(/https:\/\/[^\s]+/)
                    currentPage = urlMatch ? urlMatch[0] : match[4]
                  }
                }
                
                // If we can't parse from logs, try to use the currentPage from progressData
                if (!currentPage && progressData.currentPage) {
                  // Extract just the URL part from the currentPage field
                  const urlMatch = progressData.currentPage.match(/https:\/\/[^\s]+/)
                  if (urlMatch) {
                    currentPage = urlMatch[0]
                  }
                }
                
                // Use progressData values as fallback
                if (!currentStep && progressData.pagesProcessed) {
                  currentStep = progressData.pagesProcessed
                }
                if (!totalSteps && progressData.estimatedTotal) {
                  totalSteps = progressData.estimatedTotal
                }
                if (!progressPercent && progressData.progressPercent) {
                  progressPercent = progressData.progressPercent
                }
                
                setProgress(prevProgress => ({
                  stage: 'scraping',
                  message: 'Crawling website and extracting content...',
                  estimatedTime,
                  startTime: prevProgress.startTime, // Preserve startTime
                  currentStep,
                  totalSteps,
                  currentPage,
                  progressPercent,
                  logs: progressData.logs,
                  stats
                }))
              }
              
              // Only stop polling and show completed when status is actually 'completed'
              if (progressData.status === 'completed') {
                clearInterval(pollInterval)
                setProgress(prevProgress => ({
                  stage: 'complete',
                  message: 'Scraping completed successfully!',
                  estimatedTime,
                  startTime: prevProgress.startTime, // Preserve startTime
                  actualDuration: progressData.actualDuration, // Add actual duration
                  logs: progressData.logs,
                  stats
                }))
                
                // Set final result with data
                if (progressData.finalData) {
                  setResult({
                    success: true,
                    data: progressData.finalData,
                    stats: progressData.finalStats,
                    logs: progressData.logs,
                    message: 'Scraping completed successfully'
                  })
                } else {
                  setResult({
                    success: true,
                    logs: progressData.logs,
                    stats: progressData.finalStats,
                    message: 'Scraping completed successfully'
                  })
                }
              }
            } else if (progressData.status === 'error') {
              clearInterval(pollInterval)
              setProgress({
                stage: 'error',
                message: getProgressMessage('error', url)
              })
              setResult({
                success: false,
                error: progressData.error || 'Scraping failed',
                logs: progressData.logs
              })
            }
          } catch (error) {
            console.error('Error polling progress:', error)
          }
        }, 1000) // Poll every second
        
        // Stop polling after 10 minutes to prevent infinite polling
        setTimeout(() => {
          clearInterval(pollInterval)
        }, 600000)
      } else {
        // Scraping failed to start
        setResult(json)
        setProgress({
          stage: 'error',
          message: getProgressMessage('error', url)
        })
      }
    } catch (error) {
      setResult({
        success: false,
        error: 'Failed to connect to scraping service',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
      setProgress({
        stage: 'error',
        message: getProgressMessage('error', url)
      })
    } finally {
      setLoading(false)
    }
  }

  const downloadData = () => {
    if (!result?.data) return

    let content = ''
    let filename = 'scraped-data'
    let mimeType = ''

    switch (exportFormat) {
      case 'json':
        content = JSON.stringify(result.data, null, 2)
        filename += '.json'
        mimeType = 'application/json'
        break
      case 'csv':
        // Convert JSON to CSV format
        if (Array.isArray(result.data)) {
          const headers = Object.keys(result.data[0] || {})
          const csvContent = [
            headers.join(','),
            ...result.data.map((item: any) => 
              headers.map(header => 
                JSON.stringify(item[header] || '')
              ).join(',')
            )
          ].join('\n')
          content = csvContent
        } else {
          content = Object.entries(result.data)
            .map(([key, value]) => `${key},${JSON.stringify(value)}`)
            .join('\n')
        }
        filename += '.csv'
        mimeType = 'text/csv'
        break
      case 'txt':
        // Convert to plain text format for AI training
        if (Array.isArray(result.data)) {
          content = result.data.map((item: any, index: number) => {
            return `Document ${index + 1}:\n${Object.entries(item)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')}\n\n`
          }).join('---\n')
        } else {
          content = Object.entries(result.data)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
        }
        filename += '.txt'
        mimeType = 'text/plain'
        break
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const copyToClipboard = () => {
    if (!result?.data) return
    
    let content = ''
    switch (exportFormat) {
      case 'json':
        content = JSON.stringify(result.data, null, 2)
        break
      case 'csv':
        if (Array.isArray(result.data)) {
          const headers = Object.keys(result.data[0] || {})
          const csvContent = [
            headers.join(','),
            ...result.data.map((item: any) => 
              headers.map(header => 
                JSON.stringify(item[header] || '')
              ).join(',')
            )
          ].join('\n')
          content = csvContent
        } else {
          content = Object.entries(result.data)
            .map(([key, value]) => `${key},${JSON.stringify(value)}`)
            .join('\n')
        }
        break
      case 'txt':
        if (Array.isArray(result.data)) {
          content = result.data.map((item: any, index: number) => {
            return `Document ${index + 1}:\n${Object.entries(item)
              .map(([key, value]) => `${key}: ${value}`)
              .join('\n')}\n\n`
          }).join('---\n')
        } else {
          content = Object.entries(result.data)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n')
        }
        break
    }
    
    navigator.clipboard.writeText(content)
  }

  return (
    <main className="min-h-screen bg-gray-900 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-700 p-4 sm:p-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6 text-gray-100">AI Training Data Scraper</h1>
          <p className="text-gray-300 mb-4 sm:mb-6 text-sm sm:text-base">
            Scrape websites and export data in formats optimized for AI agent training
          </p>

          {/* Compact Filter Controls */}
          <div className="mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              {/* Filter Depth Control */}
              <div className="flex-1">
                <label htmlFor="filterDepth" className="block text-xs font-medium text-gray-300 mb-1">
                  Filter Depth
                  <span className="ml-1 text-gray-500 cursor-help" title="Controls which pages to crawl based on URL path matching">
                    ⓘ
                  </span>
                </label>
                <select
                  id="filterDepth"
                  value={filterDepth}
                  onChange={(e) => setFilterDepth(Number(e.target.value))}
                  className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  disabled={loading}
                >
                  <option value={1}>Level 1 - Same game/section</option>
                  <option value={2}>Level 2 - Same subsection</option>
                  <option value={3}>Level 3 - Same category</option>
                  <option value={0}>No filtering</option>
                </select>
              </div>

              {/* Max Depth Control */}
              <div className="flex-1">
                <label htmlFor="maxDepth" className="block text-xs font-medium text-gray-300 mb-1">
                  Max Depth
                  <span className="ml-1 text-gray-500 cursor-help" title="Controls how deep to crawl from the starting page">
                    ⓘ
                  </span>
                </label>
                <select
                  id="maxDepth"
                  value={maxDepth || ''}
                  onChange={(e) => setMaxDepth(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  disabled={loading}
                >
                  <option value="">No limit</option>
                  <option value={1}>Level 1 - Starting page only</option>
                  <option value={2}>Level 2 - + Direct links</option>
                  <option value={3}>Level 3 - + 2 levels deep</option>
                  <option value={5}>Level 5 - + 4 levels deep</option>
                </select>
              </div>
            </div>

            {/* Help Text (Collapsible) */}
            <details className="mt-2">
              <summary className="text-xs text-blue-400 cursor-pointer hover:text-blue-300 transition-colors">
                ℹ️ How do these controls work?
              </summary>
              <div className="mt-2 p-3 bg-gray-700 rounded-md text-xs text-gray-300 space-y-2">
                <div>
                  <strong>Filter Depth:</strong> Controls which pages to crawl based on URL matching.
                  <ul className="mt-1 ml-4 space-y-1">
                    <li>• <strong>Level 1:</strong> Only crawl pages from same game (e.g., all /d4/ pages)</li>
                    <li>• <strong>Level 2:</strong> Only crawl pages from same subsection (e.g., all /d4/getting-started/ pages)</li>
                    <li>• <strong>Level 3:</strong> Only crawl pages from same category (e.g., all /d4/getting-started/first-steps/ pages)</li>
                    <li>• <strong>No filtering:</strong> Crawl all pages on the site</li>
                  </ul>
                </div>
                <div>
                  <strong>Max Depth:</strong> Controls how deep to crawl from the starting page.
                  <ul className="mt-1 ml-4 space-y-1">
                    <li>• <strong>No limit:</strong> Crawl as deep as the site structure allows</li>
                    <li>• <strong>Level 1:</strong> Only scrape the starting page (fastest)</li>
                    <li>• <strong>Higher levels:</strong> Follow links deeper into the site</li>
                  </ul>
                </div>
              </div>
            </details>
          </div>

          {/* URL Input Section */}
          <div className="mb-4 sm:mb-6">
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="url" className="block text-sm font-medium text-gray-200">
                Website URL to Scrape
              </label>
              {/* Settings Summary */}
              <div className="flex gap-1 text-xs">
                <span className="px-2 py-1 bg-blue-900/50 text-blue-200 rounded">
                  Filter: {filterDepth === 0 ? 'None' : `L${filterDepth}`}
                </span>
                <span className="px-2 py-1 bg-green-900/50 text-green-200 rounded">
                  Depth: {maxDepth || '∞'}
                </span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="url"
                type="text"
                placeholder="https://maxroll.gg/d4/getting-started/first-steps-in-diablo-4"
                className="flex-1 bg-gray-700 border border-gray-600 rounded-md px-3 py-2 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm sm:text-base"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
              />
              <button
                className="bg-blue-600 text-white px-4 sm:px-6 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors text-sm sm:text-base whitespace-nowrap"
                disabled={!url || loading}
                onClick={scrape}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    Scraping...
                  </span>
                ) : (
                  'Scrape'
                )}
              </button>
            </div>
          </div>

          {/* Progress Section */}
          {(loading || progress.stage !== 'idle') && (
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-blue-900/30 border border-blue-700 rounded-md">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 gap-2">
                <span className="text-blue-300 font-medium text-sm sm:text-base">{progress.message}</span>
                <div className="flex flex-col items-end text-xs sm:text-sm">
                  <span className="text-blue-200">
                    Started: {progress.startTime ? new Date(progress.startTime).toLocaleTimeString() : '--'}
                  </span>
                  <span className="text-blue-200">
                    {progress.actualDuration ? 
                      `Completed in ${progress.actualDuration}` : 
                      `Est. ${currentTimeEstimate || progress.estimatedTime || 'Calculating...'}`
                    }
                  </span>
                </div>
              </div>
              
              {/* Live Progress Bar */}
              <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                <div 
                  className="h-2 rounded-full transition-all duration-500 bg-blue-500"
                  style={{
                    width: progress.stage === 'initializing' ? '25%' :
                           progress.stage === 'scraping' && progress.currentStep && progress.totalSteps ? 
                             `${Math.min((progress.currentStep / progress.totalSteps) * 100, 100)}%` :
                           progress.stage === 'scraping' ? '50%' :
                           progress.stage === 'complete' ? '100%' : '100%'
                  }}
                ></div>
              </div>
              
              {/* Live Statistics */}
              {progress.stage === 'scraping' && progress.stats && (
                <div className="mt-3 space-y-2">
                  {/* Current Page and Progress */}
                  {progress.currentPage && (
                    <div className="text-xs text-blue-200">
                      <div className="flex items-center gap-2">
                        <span className="flex-shrink-0">🔄 Currently processing:</span>
                        <span className="text-blue-300 truncate" title={progress.currentPage}>
                          {truncateUrl(progress.currentPage)}
                        </span>
                        {progress.currentStep && progress.totalSteps && (
                          <span className="text-blue-300 flex-shrink-0">({progress.currentStep}/{progress.totalSteps} - {progress.progressPercent?.toFixed(1)}%)</span>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Spider Statistics */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <div className="bg-gray-800 p-2 rounded">
                      <div className="text-green-300 font-medium">Pages Processed</div>
                      <div className="text-white">{progress.stats.pagesProcessed}</div>
                    </div>
                    <div className="bg-gray-800 p-2 rounded">
                      <div className="text-blue-300 font-medium">Total Discovered</div>
                      <div className="text-white">{progress.stats.totalUrlsDiscovered}</div>
                    </div>
                    <div className="bg-gray-800 p-2 rounded">
                      <div className="text-purple-300 font-medium">Total Scraped</div>
                      <div className="text-white">{progress.stats.totalUrlsScraped}</div>
                    </div>
                    <div className="bg-gray-800 p-2 rounded">
                      <div className="text-yellow-300 font-medium">Filtered Out</div>
                      <div className="text-white">{progress.stats.pagesFiltered}</div>
                    </div>
                    <div className="bg-gray-800 p-2 rounded">
                      <div className="text-orange-300 font-medium">Duplicates Skipped</div>
                      <div className="text-white">{progress.stats.duplicateUrlsSkipped}</div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Live Progress Logs */}
              {progress.logs && progress.logs.length > 0 && (
                <details className="mt-3" open>
                  <summary className="text-xs text-blue-300 cursor-pointer hover:text-blue-200 transition-colors">
                    📊 Live Progress ({progress.logs.length} updates)
                  </summary>
                  <div className="mt-2 max-h-32 overflow-y-auto bg-gray-800 rounded p-2 text-xs text-gray-300 space-y-1">
                    {progress.logs.slice(-10).map((log, index) => (
                      <div key={index} className="font-mono">
                        {log.includes('Processing page') ? (
                          <span className="text-green-400">🔄 {log}</span>
                        ) : log.includes('Found') ? (
                          <span className="text-blue-400">🔗 {log}</span>
                        ) : log.includes('Spider initialized') ? (
                          <span className="text-yellow-400">🚀 {log}</span>
                        ) : log.includes('Spider finished') ? (
                          <span className="text-green-400">✅ {log}</span>
                        ) : log.includes('Estimated') ? (
                          <span className="text-purple-400">📊 {log}</span>
                        ) : log.includes('ERROR') ? (
                          <span className="text-red-400">❌ {log}</span>
                        ) : (
                          <span className="text-gray-400">ℹ️ {log}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Results Section */}
          {result && (
            <div className="border-t border-gray-700 pt-4 sm:pt-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
                <h2 className="text-lg sm:text-xl font-semibold text-gray-100">
                  Scraping Results
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm text-gray-300">Export format:</span>
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as 'json' | 'csv' | 'txt')}
                    className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs sm:text-sm text-gray-100"
                  >
                    <option value="json">JSON</option>
                    <option value="csv">CSV</option>
                    <option value="txt">Plain Text</option>
                  </select>
                </div>
              </div>

              {/* Status */}
              <div className={`p-4 rounded-md mb-4 ${
                result.success 
                  ? 'bg-green-900/30 border border-green-700' 
                  : 'bg-red-900/30 border border-red-700'
              }`}>
                <div className="flex items-center gap-2">
                  {result.success ? (
                    <svg className="w-5 h-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
                    </svg>
                  )}
                  <span className={`font-medium ${
                    result.success ? 'text-green-300' : 'text-red-300'
                  }`}>
                    {result.success ? 'Scraping completed successfully' : 'Scraping failed'}
                  </span>
                </div>
                {result.message && (
                  <p className="mt-2 text-sm text-gray-300">{result.message}</p>
                )}
                {result.error && (
                  <p className="mt-2 text-sm text-red-300">{result.error}</p>
                )}
                {result.stats && (
                  <div className="mt-2 text-xs sm:text-sm text-gray-300 space-y-1">
                    <p>Items processed: {result.stats.originalItems}</p>
                    {result.stats?.filterDepth !== undefined && (
                      <p>Filter Depth: Level {result.stats.filterDepth} {
                        result.stats.filterDepth === 0 ? '(no filtering)' :
                        result.stats.filterDepth === 1 ? '(same game/section)' :
                        result.stats.filterDepth === 2 ? '(same subsection)' :
                        result.stats.filterDepth === 3 ? '(same category)' :
                        '(custom depth)'
                      }</p>
                    )}
                    {result.stats?.maxDepth && (
                      <p>Max Depth: {result.stats.maxDepth === 'unlimited' ? 'No limit' : `Level ${result.stats.maxDepth}`}</p>
                    )}
                    {result.stats?.pathFilter && result.stats?.filterDepth && result.stats.filterDepth > 0 && (
                      <p>Filter Path: {result.stats.pathFilter}</p>
                    )}
                    {result.stats?.filteredAtSource && (
                      <p className="text-green-300">✓ Filtered at source for efficiency</p>
                    )}
                    {result.stats?.actualDuration && (
                      <p>Actual Duration: {result.stats.actualDuration}</p>
                    )}
                    
                    {/* Detailed Spider Statistics */}
                    {result.stats?.pagesProcessed !== undefined && (
                      <div className="mt-3 p-2 bg-gray-800 rounded border border-gray-600">
                        <p className="font-medium text-blue-300 mb-1">📊 Detailed Statistics:</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs">
                          <p>Pages Processed: <span className="text-green-300">{result.stats.pagesProcessed}</span></p>
                          <p>Pages Filtered Out: <span className="text-yellow-300">{result.stats.pagesFiltered}</span></p>
                          <p>Duplicate URLs Skipped: <span className="text-orange-300">{result.stats.duplicateUrlsSkipped}</span></p>
                          <p>Total URLs Discovered: <span className="text-blue-300">{result.stats.totalUrlsDiscovered}</span></p>
                          <p>Total URLs Scraped: <span className="text-purple-300">{result.stats.totalUrlsScraped}</span></p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                
                {/* Scraping Summary */}
                {result.logs && result.logs.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-medium text-blue-300 hover:text-blue-200 transition-colors">
                      📋 Scraping Summary ({result.logs.length} log entries)
                    </summary>
                    <div className="mt-2 max-h-48 overflow-y-auto bg-gray-800 rounded p-2 text-xs text-gray-300 space-y-1">
                      {result.logs.map((log, index) => (
                        <div key={index} className="font-mono">
                          {log.includes('Processing page') ? (
                            <span className="text-green-400">🔄 {log}</span>
                          ) : log.includes('Found') ? (
                            <span className="text-blue-400">🔗 {log}</span>
                          ) : log.includes('Spider initialized') ? (
                            <span className="text-yellow-400">🚀 {log}</span>
                          ) : log.includes('Spider finished') ? (
                            <span className="text-green-400">✅ {log}</span>
                          ) : log.includes('ERROR') ? (
                            <span className="text-red-400">❌ {log}</span>
                          ) : (
                            <span className="text-gray-400">ℹ️ {log}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              {/* Action Buttons */}
              {result.success && result.data && (
                <div className="flex flex-col sm:flex-row gap-2 mb-4">
                  <button
                    onClick={downloadData}
                    className="bg-green-600 text-white px-3 sm:px-4 py-2 rounded-md hover:bg-green-700 transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
                    </svg>
                    Download {exportFormat.toUpperCase()}
                  </button>
                  <button
                    onClick={copyToClipboard}
                    className="bg-gray-600 text-white px-3 sm:px-4 py-2 rounded-md hover:bg-gray-700 transition-colors flex items-center justify-center gap-2 text-sm"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
                      <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 00-3 3H9a3 3 0 00-3-3z"/>
                    </svg>
                    Copy to Clipboard
                  </button>
                </div>
              )}

              {/* Data Preview */}
              {result.data && (
                <details className="bg-gray-700 rounded-md">
                  <summary className="p-3 sm:p-4 cursor-pointer hover:bg-gray-600 transition-colors">
                    <h3 className="text-sm font-medium text-gray-200 inline-flex items-center gap-2">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
                      </svg>
                      Data Preview ({Array.isArray(result.data) ? result.data.length : 1} items)
                    </h3>
                  </summary>
                  <div className="p-3 sm:p-4 pt-0">
                    {/* Compact Format Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-2 mb-3">
                      <button
                        onClick={() => {
                          const compactData = Array.isArray(result.data) 
                            ? result.data.map(item => JSON.stringify(item, null, 0)).join('\n')
                            : JSON.stringify(result.data, null, 0)
                          navigator.clipboard.writeText(compactData)
                        }}
                        className="bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 text-sm"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
                          <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 00-3 3H9a3 3 0 00-3-3z"/>
                        </svg>
                        Copy Compact JSON
                      </button>
                      <button
                        onClick={() => {
                          const compactData = Array.isArray(result.data) 
                            ? result.data.map(item => JSON.stringify(item, null, 0)).join('\n')
                            : JSON.stringify(result.data, null, 0)
                          
                          // Generate filename like the output files
                          const urlObj = new URL(url)
                          const domain = urlObj.hostname.replace(/\./g, '_')
                          const pathSegment = urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
                          const today = new Date().toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD format
                          const filename = `output_${domain}_${pathSegment}_${today}.json`
                          
                          const blob = new Blob([compactData], { type: 'application/json' })
                          const url2 = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url2
                          a.download = filename
                          document.body.appendChild(a)
                          a.click()
                          document.body.removeChild(a)
                          URL.revokeObjectURL(url2)
                        }}
                        className="bg-green-600 text-white px-3 py-2 rounded-md hover:bg-green-700 transition-colors flex items-center justify-center gap-2 text-sm"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
                        </svg>
                        Download Compact JSON
                      </button>
                    </div>
                    
                    <pre className="text-xs sm:text-sm overflow-auto max-h-64 sm:max-h-96 bg-gray-800 p-3 sm:p-4 rounded border border-gray-600 text-gray-100">
                      {Array.isArray(result.data) 
                        ? result.data.map(item => JSON.stringify(item, null, 0)).join('\n')
                        : JSON.stringify(result.data, null, 0)
                      }
                    </pre>
                  </div>
                </details>
              )}

              {/* Debug Info */}
              {(result.stdout || result.stderr) && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-gray-300 transition-colors">
                    🔧 Debug Information
                  </summary>
                  <div className="mt-2 space-y-2">
                    {result.stdout && (
                      <div>
                        <h4 className="text-xs font-medium text-gray-400 uppercase">STDOUT</h4>
                        <pre className="text-xs bg-gray-800 p-2 rounded overflow-auto max-h-32 text-gray-200 border border-gray-600">
                          {result.stdout}
                        </pre>
                      </div>
                    )}
                    {result.stderr && (
                      <div>
                        <h4 className="text-xs font-medium text-gray-400 uppercase">STDERR</h4>
                        <pre className="text-xs bg-red-900/30 p-2 rounded overflow-auto max-h-32 text-red-300 border border-red-700">
                          {result.stderr}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
