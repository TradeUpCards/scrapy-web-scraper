import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'

// Global progress tracking (in a real app, use Redis or database)
let currentProgress: any = null

export async function POST(request: NextRequest) {
  try {
    const { url, filterDepth = 1, maxDepth } = await request.json()
    
    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      )
    }

    // Validate URL format
    try {
      new URL(url)
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      )
    }

    // Validate filterDepth
    if (filterDepth < 0 || filterDepth > 5) {
      return NextResponse.json(
        { error: 'Filter depth must be between 0 and 5' },
        { status: 400 }
      )
    }

    // Validate maxDepth if provided
    if (maxDepth !== undefined && (maxDepth < 1 || maxDepth > 10)) {
      return NextResponse.json(
        { error: 'Max depth must be between 1 and 10' },
        { status: 400 }
      )
    }

    // Set up environment with Scrapy in PATH
    const env = { ...process.env }
    const scrapyPath = 'C:\\Users\\User\\AppData\\Roaming\\Python\\Python312\\Scripts'
    const scrapyExe = `${scrapyPath}\\scrapy.exe`
    if (env.PATH) {
      env.PATH = `${scrapyPath};${env.PATH}`
    } else {
      env.PATH = scrapyPath
    }

    console.log('Environment setup:', {
      scrapyPath,
      scrapyExe,
      PATH: env.PATH,
      platform: process.platform
    })

    // Initialize progress tracking
    currentProgress = {
      status: 'starting',
      logs: [],
      currentPage: '',
      progressPercent: 0,
      pagesProcessed: 0,
      estimatedTotal: 0,
      pagesFiltered: 0,
      duplicateUrlsSkipped: 0,
      totalUrlsDiscovered: 0,
      totalUrlsScraped: 0,
      startTime: new Date().toISOString(),
      completionTime: null,
      actualDuration: null
    }

    // Start the scraping process in the background
    startScrapingProcess(url, filterDepth, maxDepth, env, scrapyExe)

    // Return immediately with initial status
    return NextResponse.json({ 
      success: true, 
      message: 'Scraping started successfully',
      status: 'started'
    })

  } catch (error) {
    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

async function startScrapingProcess(url: string, filterDepth: number, maxDepth: number | undefined, env: any, scrapyExe: string) {
  try {
    // Generate unique filename based on URL and date
    const urlObj = new URL(url)
    const domain = urlObj.hostname.replace(/\./g, '_')
    const pathSegment = urlObj.pathname.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '') // YYYYMMDD format
    const filename = `output_${domain}_${pathSegment}_${today}.json`
    
    console.log('Generated filename:', filename)
    
    // Check if Scrapy is available
    const checkScrapyProcess = spawn(scrapyExe, ['--version'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })

    // Add timeout for scrapy check (30 seconds)
    const checkTimeout = setTimeout(() => {
      console.log('Scrapy check timeout reached, killing process')
      checkScrapyProcess.kill('SIGTERM')
      currentProgress.status = 'error'
      currentProgress.error = 'Scrapy check timed out after 30 seconds'
    }, 30000) // 30 seconds

    checkScrapyProcess.on('close', (code) => {
      clearTimeout(checkTimeout) // Clear the timeout
      if (code !== 0) {
        currentProgress.status = 'error'
        currentProgress.error = 'Scrapy is not available'
        return
      }

      // Scrapy is available, now run the spider
      const spiderArgs = ['crawl', 'maxroll', '-a', `start_urls=${url}`, '-a', `filter_depth=${filterDepth}`, '-a', `output_file=${filename}`, '-a', 'max_pages=10000']
      if (maxDepth !== undefined) {
        spiderArgs.push('-a', `max_depth=${maxDepth}`)
      }
      spiderArgs.push('--loglevel=INFO')
      
      // Force JSONLines format with compact output
      spiderArgs.push('-s', 'FEED_FORMAT="jsonlines"')
      spiderArgs.push('-s', 'FEED_EXPORT_INDENT=0')
      spiderArgs.push('-s', 'FEED_EXPORT_ENCODING="utf-8"')
      spiderArgs.push('-s', 'FEED_EXPORT_OVERWRITE=true')
      
      console.log('Starting spider with args:', spiderArgs)
      
      // Delete existing output file to ensure clean start
      try {
        const fs = require('fs')
        const outputPath = path.join(process.cwd(), filename)
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath)
          console.log('Deleted existing output file:', filename)
        }
      } catch (error) {
        console.log('Could not delete existing file:', error)
      }
      
      const spiderProcess = spawn(scrapyExe, spiderArgs, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      })

      let stdout = ''
      let stderr = ''
      let logs: string[] = []

      // Add timeout mechanism (30 minutes)
      const timeout = setTimeout(() => {
        console.log('Spider process timeout reached, killing process')
        spiderProcess.kill('SIGTERM')
        currentProgress.status = 'error'
        currentProgress.error = 'Scraping timed out after 30 minutes'
      }, 1800000) // 30 minutes

      // Helper function to parse logs
      const parseLogLine = (line: string) => {
        console.log('Processing line:', line.trim())
        
        if (line.includes('Processing page') || 
            line.includes('Found') || 
            line.includes('Spider initialized') ||
            line.includes('Spider finished') ||
            line.includes('Estimated') ||
            line.includes('Summary:') ||
            line.includes('Pages processed:') ||
            line.includes('Pages filtered out:') ||
            line.includes('Duplicate URLs skipped:') ||
            line.includes('Total URLs discovered:') ||
            line.includes('Total URLs scraped:') ||
            line.includes('Pages exceeding max depth:')) {
          logs.push(line.trim())
          
          // Update progress tracking
          currentProgress.logs = logs
          currentProgress.status = 'processing'
          
          console.log('Updated status to processing, current logs count:', logs.length)
          
          // Parse current page and progress
          if (line.includes('Processing page')) {
            const match = line.match(/Processing page (\d+)\/(\d+) \(([\d.]+)%\): (.+)/)
            if (match) {
              const [, current, total, percent, url] = match
              currentProgress.currentPage = url
              currentProgress.progressPercent = parseFloat(percent)
              currentProgress.pagesProcessed = parseInt(current)
              currentProgress.estimatedTotal = parseInt(total)
              console.log('Parsed processing page:', { current, total, percent, url })
            }
          }
          
          // Parse spider summary statistics
          if (line.includes('Spider finished. Summary:')) {
            currentProgress.status = 'completed'
            console.log('Spider finished, setting status to completed')
          }
          
          // Parse individual statistics with better regex patterns
          if (line.includes('Pages processed:')) {
            const match = line.match(/Pages processed:\s*(\d+)/)
            if (match) {
              currentProgress.pagesProcessed = parseInt(match[1])
              console.log('Parsed pages processed:', currentProgress.pagesProcessed)
            }
          }
          if (line.includes('Pages filtered out:')) {
            const match = line.match(/Pages filtered out:\s*(\d+)/)
            if (match) {
              currentProgress.pagesFiltered = parseInt(match[1])
              console.log('Parsed pages filtered:', currentProgress.pagesFiltered)
            }
          }
          if (line.includes('Duplicate URLs skipped:')) {
            const match = line.match(/Duplicate URLs skipped:\s*(\d+)/)
            if (match) {
              currentProgress.duplicateUrlsSkipped = parseInt(match[1])
              console.log('Parsed duplicate URLs skipped:', currentProgress.duplicateUrlsSkipped)
            }
          }
          if (line.includes('Total URLs discovered:')) {
            const match = line.match(/Total URLs discovered:\s*(\d+)/)
            if (match) {
              currentProgress.totalUrlsDiscovered = parseInt(match[1])
              console.log('Parsed total URLs discovered:', currentProgress.totalUrlsDiscovered)
            }
          }
          if (line.includes('Total URLs scraped:')) {
            const match = line.match(/Total URLs scraped:\s*(\d+)/)
            if (match) {
              currentProgress.totalUrlsScraped = parseInt(match[1])
              console.log('Parsed total URLs scraped:', currentProgress.totalUrlsScraped)
            }
          }
          if (line.includes('Pages exceeding max depth:')) {
            const match = line.match(/Pages exceeding max depth:\s*(\d+)/)
            if (match) {
              currentProgress.depthExceeded = parseInt(match[1])
              console.log('Parsed depth exceeded:', currentProgress.depthExceeded)
            }
          }
          
          // Also parse the indented format from the closed method
          if (line.includes('  - Pages processed:')) {
            const match = line.match(/  - Pages processed:\s*(\d+)/)
            if (match) {
              currentProgress.pagesProcessed = parseInt(match[1])
              console.log('Parsed pages processed (indented):', currentProgress.pagesProcessed)
            }
          }
          if (line.includes('  - Pages filtered out:')) {
            const match = line.match(/  - Pages filtered out:\s*(\d+)/)
            if (match) {
              currentProgress.pagesFiltered = parseInt(match[1])
              console.log('Parsed pages filtered (indented):', currentProgress.pagesFiltered)
            }
          }
          if (line.includes('  - Duplicate URLs skipped:')) {
            const match = line.match(/  - Duplicate URLs skipped:\s*(\d+)/)
            if (match) {
              currentProgress.duplicateUrlsSkipped = parseInt(match[1])
              console.log('Parsed duplicate URLs skipped (indented):', currentProgress.duplicateUrlsSkipped)
            }
          }
          if (line.includes('  - Total URLs discovered:')) {
            const match = line.match(/  - Total URLs discovered:\s*(\d+)/)
            if (match) {
              currentProgress.totalUrlsDiscovered = parseInt(match[1])
              console.log('Parsed total URLs discovered (indented):', currentProgress.totalUrlsDiscovered)
            }
          }
          if (line.includes('  - Total URLs scraped:')) {
            const match = line.match(/  - Total URLs scraped:\s*(\d+)/)
            if (match) {
              currentProgress.totalUrlsScraped = parseInt(match[1])
              console.log('Parsed total URLs scraped (indented):', currentProgress.totalUrlsScraped)
            }
          }
          if (line.includes('  - Pages exceeding max depth:')) {
            const match = line.match(/  - Pages exceeding max depth:\s*(\d+)/)
            if (match) {
              currentProgress.depthExceeded = parseInt(match[1])
              console.log('Parsed depth exceeded (indented):', currentProgress.depthExceeded)
            }
          }
        }
      }

      spiderProcess.stdout.on('data', (data) => {
        const output = data.toString()
        stdout += output
        console.log('Spider stdout:', output)
        
        // Parse log lines for progress information
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          parseLogLine(line)
        })
      })

      spiderProcess.stderr.on('data', (data) => {
        const output = data.toString()
        stderr += output
        console.log('Spider stderr:', output)
        
        // Parse log lines for progress information (spider logs come through stderr)
        const lines = output.split('\n')
        lines.forEach((line: string) => {
          // Debug: Check if this is a final statistics line
          if (line.includes('Total URLs discovered:') || line.includes('Total URLs scraped:')) {
            console.log('Found final statistics line:', line.trim())
          }
          parseLogLine(line)
        })
      })

      spiderProcess.on('close', (code) => {
        console.log('Spider process closed with code:', code)
        clearTimeout(timeout) // Clear the timeout
        currentProgress.status = 'completed'
        currentProgress.completionTime = new Date().toISOString()
        
        // Calculate actual duration
        if (currentProgress.startTime) {
          const start = new Date(currentProgress.startTime)
          const end = new Date(currentProgress.completionTime)
          const durationMs = end.getTime() - start.getTime()
          const durationMinutes = Math.round(durationMs / 60000 * 10) / 10
          currentProgress.actualDuration = `${durationMinutes} minutes`
          console.log('Actual scraping duration:', currentProgress.actualDuration)
        }

        // Debug: Log the final statistics that were parsed
        console.log('Final parsed statistics:', {
          pagesProcessed: currentProgress.pagesProcessed,
          pagesFiltered: currentProgress.pagesFiltered,
          duplicateUrlsSkipped: currentProgress.duplicateUrlsSkipped,
          totalUrlsDiscovered: currentProgress.totalUrlsDiscovered,
          totalUrlsScraped: currentProgress.totalUrlsScraped,
          depthExceeded: currentProgress.depthExceeded
        })

        if (code === 0) {
          // Try to read the output file immediately
          try {
            const fs = require('fs')
            const outputPath = path.join(process.cwd(), filename)
            
            if (fs.existsSync(outputPath)) {
              const output = fs.readFileSync(outputPath, 'utf8')
              let data
              
              try {
                // Try to parse as JSON array
                data = JSON.parse(output)
              } catch (parseError) {
                // If it's not valid JSON, try line-by-line parsing
                const lines = output.trim().split('\n')
                data = lines.map((line: string) => {
                  try {
                    return JSON.parse(line)
                  } catch {
                    return null
                  }
                }).filter(Boolean)
              }

              // Ensure data is an array of objects
              if (!Array.isArray(data)) {
                data = [data]
              }
              
              // Store the final result in currentProgress immediately
              currentProgress.finalData = data
              currentProgress.finalStats = {
                originalItems: Array.isArray(data) ? data.length : 1,
                pathFilter: new URL(url).pathname.split('/').filter(part => part)[0] || 'none',
                filterDepth: filterDepth,
                maxDepth: maxDepth || 'unlimited',
                filteredAtSource: filterDepth > 0,
                pagesProcessed: currentProgress.pagesProcessed || (Array.isArray(data) ? data.length : 1),
                pagesFiltered: currentProgress.pagesFiltered || 0,
                duplicateUrlsSkipped: currentProgress.duplicateUrlsSkipped || 0,
                totalUrlsDiscovered: currentProgress.totalUrlsDiscovered || 0,
                totalUrlsScraped: currentProgress.totalUrlsScraped || (Array.isArray(data) ? data.length : 1),
                depthExceeded: currentProgress.depthExceeded || 0,
                actualDuration: currentProgress.actualDuration || 'Unknown'
              }
              
              console.log('Final stats set:', currentProgress.finalStats)
            }
          } catch (error) {
            currentProgress.error = error instanceof Error ? error.message : String(error)
          }
        } else {
          currentProgress.error = `Scraping failed with code ${code}`
        }
      })

      spiderProcess.on('error', (error) => {
        console.log('Spider process error:', error)
        clearTimeout(timeout) // Clear the timeout
        currentProgress.status = 'error'
        currentProgress.error = `Failed to start scraping process: ${error.message}`
      })
    })

    checkScrapyProcess.on('error', (error) => {
      console.log('Scrapy check error:', error)
      clearTimeout(checkTimeout) // Clear the timeout
      currentProgress.status = 'error'
      currentProgress.error = `Scrapy is not available: ${error.message}`
    })
  } catch (error) {
    currentProgress.status = 'error'
    currentProgress.error = error instanceof Error ? error.message : String(error)
  }
}

// Progress endpoint for polling
export async function GET() {
  console.log('GET /api/scrape called, currentProgress:', currentProgress)
  
  // If no progress exists, return a test response
  if (!currentProgress) {
    console.log('No currentProgress, returning idle status')
    return NextResponse.json({ status: 'idle', message: 'No scraping in progress' })
  }
  
  console.log('Returning currentProgress:', currentProgress)
  return NextResponse.json(currentProgress)
} 