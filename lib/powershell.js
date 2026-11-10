'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { quoteForCreateProcess } = require('./args');

const ERROR_ENVELOPE_PREFIX = 'TARV_ERROR_BASE64:';

/**
 * PowerShell 调用工具。
 *
 * 旧实现把用户可控路径拼进命令字符串，再交给 `exec()`（内部走 cmd.exe）：
 *
 *   exec(`powershell -Command "${script}"`)
 *
 * 只要路径里出现一个双引号，就能跳出外层引号进入 cmd 解析，形成命令注入。
 *
 * 现在统一改为 `-EncodedCommand`：脚本先转成 UTF-16LE + Base64，由 PowerShell
 * 自己解码执行，整条命令不经过 cmd.exe，也不存在任何引号嵌套问题。
 * 脚本内部的所有外部字符串一律用单引号字面量，并把 `'` 转义为 `''`。
 */

/** 把任意字符串安全地变成 PowerShell 单引号字面量。 */
function psQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/** 把脚本编码为 -EncodedCommand 需要的 Base64（UTF-16LE）。 */
function encodeCommand(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

/** 找到可用的 powershell.exe，优先用绝对路径，避免 PATH 被篡改。 */
function resolvePowerShellPath() {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    path.join(sysRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (err) {
      /* 忽略探测失败 */
    }
  }
  return 'powershell.exe';
}

/** 构造图标提取脚本，输出 PNG 的 Base64，并显式释放 GDI/流资源。 */
function buildIconExtractScript(targetPath, iconIndex = 0) {
  const safeIndex = Number.isInteger(iconIndex) ? iconIndex : 0;
  const lines = [
    'Add-Type -AssemblyName System.Drawing;',
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class TarVNativeIcons {',
    '  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]',
    '  public static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);',
    '  [DllImport("user32.dll", SetLastError = true)]',
    '  public static extern bool DestroyIcon(IntPtr handle);',
    '}',
    "'@;",
    '$large = New-Object IntPtr[] 1;',
    '$small = New-Object IntPtr[] 1;',
    `$null = [TarVNativeIcons]::ExtractIconEx(${psQuote(targetPath)}, ${safeIndex}, $large, $small, 1);`,
    '$handle = if ($large[0] -ne [IntPtr]::Zero) { $large[0] } else { $small[0] };',
    '$icon = if ($handle -ne [IntPtr]::Zero) { [System.Drawing.Icon]::FromHandle($handle).Clone() } else { $null };'
  ];

  lines.push(
    'if ($icon) {',
    '  $bitmap = $null;',
    '  $stream = $null;',
    '  try {',
    '    $bitmap = $icon.ToBitmap();',
    '    $stream = New-Object System.IO.MemoryStream;',
    '    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png);',
    '    [Convert]::ToBase64String($stream.ToArray())',
    '  } finally {',
    '    if ($stream) { $stream.Dispose() }',
    '    if ($bitmap) { $bitmap.Dispose() }',
    '    $icon.Dispose()',
    '    if ($handle -and $handle -ne [IntPtr]::Zero) { [void][TarVNativeIcons]::DestroyIcon($handle) }',
    '    if ($small -and $small[0] -ne [IntPtr]::Zero -and $small[0] -ne $handle) { [void][TarVNativeIcons]::DestroyIcon($small[0]) }',
    '  }',
    '}'
  );
  return lines.join('\n');
}

function wrapPowerShellScript(script) {
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$ErrorActionPreference = 'Stop'",
    '$utf8 = New-Object System.Text.UTF8Encoding($false)',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    'try {',
    '& {',
    // PowerShell here-string terminators must start in column 1. Indenting the
    // supplied script turns a valid `\'@` terminator into a parser error.
    String(script),
    '}',
    '} catch {',
    "  $message = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { 'PowerShell operation failed' }",
    '  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($message))',
    `  [Console]::Error.Write('${ERROR_ENVELOPE_PREFIX}' + $encoded)`,
    '  exit 1',
    '}'
  ].join('\n');
}

function decodePowerShellError(rawStderr) {
  const raw = String(rawStderr || '').trim();
  const markerIndex = raw.lastIndexOf(ERROR_ENVELOPE_PREFIX);
  if (markerIndex >= 0) {
    const encoded = raw.slice(markerIndex + ERROR_ENVELOPE_PREFIX.length).match(/^[A-Za-z0-9+/=]+/);
    if (encoded) {
      try {
        const decoded = Buffer.from(encoded[0], 'base64').toString('utf8').trim();
        if (decoded) return decoded;
      } catch (_) {
        /* malformed envelope falls through to a safe message */
      }
    }
  }
  if (!raw) return '';
  if (raw.startsWith('#< CLIXML') || raw.includes('<Objs Version=')) return 'PowerShell 操作失败';
  return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 2048);
}

/**
 * 构造通过 .NET ProcessStartInfo 启动进程的脚本。
 *
 * 用 ProcessStartInfo 而不是 Start-Process，是因为 `Arguments` 是一个
 * 原始字符串，PowerShell 不会对它做二次引用，转义结果完全可控。
 * 提权通过 `Verb = 'RunAs'` 触发 UAC，等价于 ShellExecute。
 */
function buildProcessStartScript(fileName, rawArguments, { elevate = false } = {}) {
  const lines = [
    '$psi = New-Object System.Diagnostics.ProcessStartInfo',
    `$psi.FileName = ${psQuote(fileName)}`,
    `$psi.Arguments = ${psQuote(rawArguments || '')}`,
    '$psi.UseShellExecute = $true'
  ];
  if (elevate) lines.push("$psi.Verb = 'RunAs'");
  lines.push('[void][System.Diagnostics.Process]::Start($psi)');
  return lines.join('\n');
}

/**
 * 执行一段 PowerShell 脚本（经 -EncodedCommand 传入）。
 * 全程不经过 cmd.exe，也不拼接命令行字符串。
 */
function runEncodedPowerShell(script, { maxStdout = 10 * 1024 * 1024, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const wrappedScript = wrapPowerShellScript(script);
    const child = spawn(resolvePowerShellPath(), [
      '-NoProfile',
      '-NonInteractive',
      '-OutputFormat',
      'Text',
      '-EncodedCommand',
      encodeCommand(wrappedScript)
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(reject, new Error(`PowerShell 操作超时（${timeoutMs}ms）`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxStdout) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 8192) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      const rawStderr = stderr.trim();
      finish(resolve, {
        code,
        stdout: stdout.trim(),
        stderr: decodePowerShellError(rawStderr),
        rawStderr
      });
    });
  });
}

/**
 * 启动一个程序，可选提权。
 *
 * 参数先按 CreateProcess 规则编码成命令行字符串，再原样交给
 * ProcessStartInfo.Arguments，不存在拼接注入面。
 *
 * @param {string} fileName 目标绝对路径
 * @param {string[]} args 已拆分好的参数数组
 * @param {{runAsAdmin?: boolean}} options
 */
async function startProcess(fileName, args, { runAsAdmin = false } = {}) {
  const rawArguments = (args || []).map(quoteForCreateProcess).join(' ');
  await startProcessRaw(fileName, rawArguments, { elevate: runAsAdmin });
}

/**
 * 以原始命令行字符串启动（调用方负责转义）。
 * 供 .bat/.cmd 这类需要自行控制 cmd 转义的场景使用。
 */
async function startProcessRaw(fileName, rawArguments, { elevate = false } = {}) {
  const script = buildProcessStartScript(fileName, rawArguments, { elevate });
  const result = await runEncodedPowerShell(script);
  if (result.code !== 0) {
    throw new Error(result.stderr || `启动失败（PowerShell 退出码 ${result.code}）`);
  }
}

module.exports = {
  psQuote,
  encodeCommand,
  resolvePowerShellPath,
  buildIconExtractScript,
  buildProcessStartScript,
  wrapPowerShellScript,
  decodePowerShellError,
  ERROR_ENVELOPE_PREFIX,
  runEncodedPowerShell,
  startProcess,
  startProcessRaw
};
