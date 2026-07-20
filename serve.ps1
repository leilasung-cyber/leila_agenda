param([int]$Port=4173)
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$listener=[System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "오늘을 정리해요: http://localhost:$Port/"
Write-Host "끝내려면 Ctrl+C를 누르세요."
$types=@{'.html'='text/html; charset=utf-8';'.css'='text/css; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.json'='application/json; charset=utf-8';'.webmanifest'='application/manifest+json';'.svg'='image/svg+xml'}
try{while($listener.IsListening){$context=$listener.GetContext();$relative=$context.Request.Url.AbsolutePath.TrimStart('/');if([string]::IsNullOrWhiteSpace($relative)){$relative='index.html'};$candidate=[IO.Path]::GetFullPath((Join-Path $root $relative));if(-not $candidate.StartsWith([IO.Path]::GetFullPath($root))-or-not(Test-Path -LiteralPath $candidate -PathType Leaf)){$context.Response.StatusCode=404;$context.Response.Close();continue};$bytes=[IO.File]::ReadAllBytes($candidate);$ext=[IO.Path]::GetExtension($candidate).ToLowerInvariant();$context.Response.ContentType=$(if($types.ContainsKey($ext)){$types[$ext]}else{'application/octet-stream'});$context.Response.ContentLength64=$bytes.Length;$context.Response.OutputStream.Write($bytes,0,$bytes.Length);$context.Response.Close()}}finally{$listener.Stop();$listener.Close()}
