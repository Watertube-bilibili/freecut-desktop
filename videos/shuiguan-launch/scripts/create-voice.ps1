$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$projectDir = Split-Path -Parent $PSScriptRoot
$items = Get-Content -LiteralPath (Join-Path $projectDir 'frames.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoice('Microsoft Huihui Desktop')
$speaker.Rate = 1
$speaker.Volume = 100
foreach ($item in $items) {
  for ($phraseIndex=0; $phraseIndex -lt $item.phrases.Count; $phraseIndex++) {
    $wave = Join-Path $projectDir ('assets/raw-voice/' + $item.id + '-' + $phraseIndex + '.wav')
    $speaker.SetOutputToWaveFile($wave)
    $speaker.Speak([string]$item.phrases[$phraseIndex])
    $speaker.SetOutputToNull()
  }
}
$speaker.Dispose()
Write-Output 'Local SAPI narration created.'
