param([int]$X, [int]$Y, [int]$ReferenceWidth = 2048)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class RowsClick {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[void][RowsClick]::SetProcessDPIAware()
$edaTarget = Get-Process lceda-pro | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like '*嘉立创EDA*' } | Select-Object -First 1
if (-not $edaTarget) { throw 'EDA window not found' }
$edaRect = New-Object RowsClick+Rect
if (-not [RowsClick]::GetWindowRect($edaTarget.MainWindowHandle,[ref]$edaRect)) { throw 'No bounds' }
$edaScale = ($edaRect.Right-$edaRect.Left) / $ReferenceWidth
$X = [int]($X*$edaScale); $Y = [int]($Y*$edaScale)
if ($X -lt 0 -or $Y -lt 0 -or $X -ge ($edaRect.Right-$edaRect.Left) -or $Y -ge ($edaRect.Bottom-$edaRect.Top)) { throw 'Outside EDA window' }
[void][RowsClick]::SetForegroundWindow($edaTarget.MainWindowHandle)
Start-Sleep -Milliseconds 200
[void][RowsClick]::SetCursorPos(($edaRect.Left+$X),($edaRect.Top+$Y))
[RowsClick]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
[RowsClick]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
