param(
    [string]$ImageTag = "smart-church/guacd:1.6.0-wave2"
)

$ErrorActionPreference = "Stop"
$sourceRoot = Join-Path $env:TEMP ("smart-church-guacd-" + [guid]::NewGuid().ToString("N"))
$patchPath = Join-Path $PSScriptRoot "guacd-wave2.patch"

try {
    git -c core.autocrlf=false clone --depth 1 --branch 1.6.0 https://github.com/apache/guacamole-server.git $sourceRoot
    if ($LASTEXITCODE -ne 0) { throw "Could not fetch the Apache Guacamole 1.6.0 source." }

    $dockerfilePath = Join-Path $sourceRoot "Dockerfile"
    $dockerfile = Get-Content -LiteralPath $dockerfilePath -Raw
    Set-Content -LiteralPath $dockerfilePath -Value $dockerfile -NoNewline

    git -C $sourceRoot apply --check $patchPath
    if ($LASTEXITCODE -ne 0) { throw "The Wave2 patch does not apply cleanly to Guacamole 1.6.0." }
    git -C $sourceRoot apply $patchPath
    if ($LASTEXITCODE -ne 0) { throw "Could not apply the Wave2 patch." }

    docker build --build-arg 'WITH_FREERDP=2\.11\.7' --build-arg 'WITH_LIBWEBSOCKETS=v4\.3\.3' --tag $ImageTag --file (Join-Path $sourceRoot "Dockerfile") $sourceRoot
    if ($LASTEXITCODE -ne 0) { throw "The patched guacd image build failed." }
    Write-Host "Built $ImageTag from Guacamole 1.6.0 with Apache PR #696."
}
finally {
    if (Test-Path -LiteralPath $sourceRoot) {
        $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
        $resolvedSource = [IO.Path]::GetFullPath($sourceRoot)
        if (-not $resolvedSource.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove build source outside the temporary directory."
        }
        Remove-Item -LiteralPath $resolvedSource -Recurse -Force
    }
}
