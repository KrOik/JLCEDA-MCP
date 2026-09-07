param([string]$OutputPath = "$PSScriptRoot/native-probe.png")
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RowsCapture {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
}
'@
[void][RowsCapture]::SetProcessDPIAware()
$edaWindow = Get-Process lceda-pro | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*嘉立创EDA*' } | Select-Object -First 1
if (-not $edaWindow) { throw 'EDA window not found' }
$rect = New-Object RowsCapture+Rect
if (-not [RowsCapture]::GetWindowRect($edaWindow.MainWindowHandle, [ref]$rect)) { throw 'Window bounds unavailable' }
$bitmap = New-Object System.Drawing.Bitmap(($rect.Right-$rect.Left),($rect.Bottom-$rect.Top))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$dc = $graphics.GetHdc()
try { if (-not [RowsCapture]::PrintWindow($edaWindow.MainWindowHandle,$dc,2)) { throw 'Window capture failed' } }
finally { $graphics.ReleaseHdc($dc) }
try { $bitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png) }
finally { $graphics.Dispose(); $bitmap.Dispose() }
