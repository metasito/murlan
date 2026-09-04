# Relauncher with staleness watchdog. Kills the CLI if its transcript goes quiet,
# then starts a fresh one that resumes mid-loop (claims live on GitHub).
# Usage:  powershell -File .scratch\loop-watchdog.ps1 [-Cli claude] [-StaleMinutes 15]
param(
  [string]$Cli = "claude",
  [string]$PromptFile = "$PSScriptRoot\loop-prompt.md",
  [int]$StaleMinutes = 15,
  [int]$MinRunMinutes = 5
)
$ErrorActionPreference = "Stop"
$prompt = Get-Content $PromptFile -Raw
$log = Join-Path $PSScriptRoot "watchdog.log"
function Log($m) { "[{0}] {1}" -f (Get-Date -Format s), $m | Add-Content $log }

while ($true) {
  Log "launching $Cli"
  $started = Get-Date
  # Watchdog job: polls the newest transcript under .claude\projects; if nothing has
  # been written for StaleMinutes past the grace window, kills every cli/node process
  # started after $started. Single-user machine assumption: this can catch a parallel
  # session's processes - acceptable here, noted in the log.
  $job = Start-Job -ScriptBlock {
    param($dir, $stale, $minRun, $started, $cli, $logPath)
    while ($true) {
      Start-Sleep -Seconds 60
      $latest = Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if (-not $latest) { continue }
      $idle = ((Get-Date) - $latest.LastWriteTime).TotalMinutes
      $age = ((Get-Date) - $started).TotalMinutes
      if ($idle -ge $stale -and $age -ge $minRun) {
        "[watchdog] transcript idle $([math]::Round($idle,1)) min - killing" |
          Add-Content $logPath
        Get-Process -ErrorAction SilentlyContinue |
          Where-Object { $_.StartTime -gt $started -and $_.ProcessName -match ($cli -split '\\')[-1] } |
          Stop-Process -Force -ErrorAction SilentlyContinue
        break
      }
    }
  } -ArgumentList "$env:USERPROFILE\.claude\projects", $StaleMinutes, $MinRunMinutes, $started, $Cli, $log

  & $Cli --dangerously-skip-permissions --continue $prompt
  $code = $LASTEXITCODE
  Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue
  Log "exited code=$code"
  Start-Sleep -Seconds 30
}
